"""Orchestrates the AI pipeline described in the plan:

    Student Question -> FastAPI -> AI model (analysis) -> Physics Solver (tools)
    -> Verified Calculations -> AI model (explanation) -> Visualization Data -> App

`answer_physics_question()` is the single entry point ai_chat.py calls.

The AI model is reached via qwen_client.chat_completion, which defaults to
Gemini's free tier (see core/config.py) but works against any
OpenAI-compatible endpoint. This module still degrades gracefully if that
call fails for any reason (missing/invalid key, rate limit, network hiccup):
it falls back to a small rule-based classifier + templated explanation, so
`/api/v1/ai/ask` never hard-fails the request even when the model is down.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.schemas.chat import VisualizationPayload
from app.services import physics_solver
from app.services.qwen_client import QwenUnavailableError, chat_completion

# Both prompts below end with the same two paragraphs (math formatting +
# "no markdown") because the mobile app's chat bubble renders these
# responses with a lightweight native formatter (components/MathText.tsx),
# not a full Markdown/KaTeX engine: it understands $...$ LaTeX (converted to
# Unicode symbols, with \frac/\dfrac drawn as a real stacked fraction) and
# **bold**, and preserves blank lines between paragraphs/steps — but has no
# concept of #headers, bullet lists, or other Markdown, which would just
# show up as literal stray characters.
_FORMATTING_RULES = """
Format every equation, fraction, and exponent as LaTeX wrapped in single
dollar signs, e.g. $v = v_0 + a t$ or $h = \\dfrac{v_{y0}^2}{2g}$ — plain-text
math should not appear outside of $...$.

Do not use Markdown headers (#) or bullet points (-, *). Do not use **bold**
except to emphasize at most one or two short key terms per answer. If you
list numbered steps, put a blank line between each one so they render as
separate lines rather than running together."""

EXPLANATION_SYSTEM_PROMPT = (
    """You are a friendly physics tutor. You are given a
verified numeric result (already computed by a solver, do NOT recompute or
contradict it) and the steps that produced it. Explain the solution to a
student clearly and step by step, in 3-6 short sentences, referencing the
given numbers. Do not invent additional numeric results.
"""
    + _FORMATTING_RULES
)

# Used whenever the analysis step decides the question isn't one of the three
# solver tools (e.g. a conceptual "what is Ohm's law" question rather than a
# numeric problem) — most real student questions land here, so this is not a
# rare fallback path.
GENERAL_TUTOR_SYSTEM_PROMPT = (
    """You are a friendly, encouraging physics tutor for
high-school/early-college students. Answer the student's question clearly and
concisely (roughly 3-8 short sentences unless the question genuinely needs
more). Reply in the same language the student asked in (Arabic or English).
If the question includes specific numbers that call for an exact calculation,
you may compute it yourself and show the steps, since no verified solver tool
matched this question.
"""
    + _FORMATTING_RULES
)

# Used when the student attaches a photo of a problem instead of (or as well
# as) typing it out — see the image_base64 branch in answer_physics_question.
IMAGE_TUTOR_SYSTEM_PROMPT = (
    """You are a friendly, encouraging physics tutor for
high-school/early-college students. The student has attached a photo of a
problem — handwritten or printed — instead of typing it out. Carefully read
everything visible in the image (the given values, units, and what's being
asked), then solve and explain it clearly and step by step, the same way you
would for a typed question. Reply in the same language as any accompanying
text from the student, or Arabic if there is none. If part of the image is
too blurry or unclear to read confidently, say so plainly and ask them to
retake the photo rather than guessing at numbers.
"""
    + _FORMATTING_RULES
)


@dataclass
class AIAnswer:
    answer: str
    steps: list[str] = field(default_factory=list)
    visualization: VisualizationPayload | None = None


# ---------------------------------------------------------------------------
# Fallback (Qwen-unavailable) question classifier — regex/keyword based.
# Good enough to exercise the full pipeline in dev/CI without a GPU server.
# ---------------------------------------------------------------------------
_NUM = r"[-+]?\d+(?:\.\d+)?"


def _classify_locally(question: str) -> tuple[str, dict] | None:
    q = question.lower()

    if "projectile" in q or ("launch" in q and "angle" in q):
        v0_m = re.search(rf"({_NUM})\s*(?:m/s|meters per second)", q)
        angle_m = re.search(rf"({_NUM})\s*(?:deg|degree)", q)
        if v0_m and angle_m:
            return "solve_projectile_motion", {"v0": float(v0_m.group(1)), "angle_deg": float(angle_m.group(1))}

    if "force" in q and "mass" in q:
        mass_m = re.search(rf"mass\s*(?:of|=|is)?\s*({_NUM})", q)
        force_ms = re.findall(rf"({_NUM})\s*n\b", q)
        if mass_m and force_ms:
            forces = [(float(f), 0.0) for f in force_ms]
            return "solve_net_force", {"forces": forces, "mass": float(mass_m.group(1))}

    if any(k in q for k in ("velocity", "acceleration", "distance", "kinematic", "initial speed")):
        v0_m = re.search(rf"(?:initial velocity|initial speed|v0)\s*(?:of|=|is)?\s*({_NUM})", q)
        a_m = re.search(rf"acceleration\s*(?:of|=|is)?\s*({_NUM})", q)
        t_m = re.search(rf"({_NUM})\s*(?:s\b|sec|second)", q)
        # Demo-scope simplification: only handles the classic "given v0, a, t,
        # find v" case (v = v0 + a*t). Extend with more solve_for targets /
        # phrasings as real usage data comes in from Phase 4.
        if v0_m and a_m and t_m:
            return "solve_kinematics", {
                "solve_for": "v",
                "v0": float(v0_m.group(1)),
                "a": float(a_m.group(1)),
                "t": float(t_m.group(1)),
            }

    return None


def _run_tool(tool_name: str, args: dict) -> dict:
    fn = physics_solver.TOOLS.get(tool_name)
    if fn is None:
        raise ValueError(f"Unknown tool: {tool_name}")
    return fn(**args)


def _build_visualization(tool_name: str, tool_result: dict) -> VisualizationPayload | None:
    if tool_name == "solve_projectile_motion" and "trajectory" in tool_result:
        return VisualizationPayload(type="motion_diagram", data=tool_result["trajectory"])
    if tool_name == "solve_kinematics":
        return VisualizationPayload(type="graph", data={"kind": "kinematics", **tool_result["result"]})
    if tool_name == "solve_net_force":
        return VisualizationPayload(
            type="free_body_diagram",
            data={"components": tool_result["components"], "result": tool_result["result"]},
        )
    return None


async def answer_physics_question(
    question: str,
    history: list[dict] | None = None,
    image_base64: str | None = None,
) -> AIAnswer:
    """`history` is prior turns in this chat session, oldest first, each a
    `{"role": "user"|"assistant", "content": ...}` dict (see ai_chat.py) —
    without it, every question was answered in total isolation, so a
    follow-up like "give me an example" had no idea what topic the student
    meant. Callers should pass the last several turns of the session.

    `image_base64` is a photo the student attached (raw base64, no data-URI
    prefix) — when present it takes over the whole answer: there's no point
    running the text-only regex classifier against a photo, so this skips
    straight to a vision-capable tutor call instead of the pipeline below.
    """
    history = history or []

    if image_base64:
        try:
            answer = await chat_completion(
                [
                    {"role": "system", "content": IMAGE_TUTOR_SYSTEM_PROMPT},
                    *history,
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": question or "Please solve the problem shown in this photo."},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
                        ],
                    },
                ],
                # Reading + reasoning over an image is slower than a plain
                # text call — give it noticeably more room than the default.
                timeout=45,
            )
            return AIAnswer(answer=answer, steps=[])
        except QwenUnavailableError:
            return AIAnswer(
                answer=(
                    "I couldn't reach the AI model to read that photo. Check your "
                    "connection and try again, or type the question instead."
                ),
                steps=[],
            )

    # 1) Classify locally (free, no API call) — regex/keyword based. This
    # used to be a separate LLM call first, but that call's JSON response
    # almost always came back wrapped in a ```json ... ``` markdown fence
    # (which fails to parse anyway, silently falling back to this same
    # local classifier) while still burning one of Gemini's free-tier
    # requests per question for nothing. The free tier's daily quota is
    # small enough (as low as 20/day on some models) that halving the
    # number of model calls per question matters a lot in practice.
    tool_name, tool_args = None, {}
    classified = _classify_locally(question)
    if classified:
        tool_name, tool_args = classified

    if not tool_name:
        # Not one of the three verified-calculation tools — most conceptual
        # questions ("what is Ohm's law", "explain electric fields", or a
        # follow-up like "give me an example") land here. Let the model
        # answer directly instead of refusing outright.
        try:
            answer = await chat_completion(
                [
                    {"role": "system", "content": GENERAL_TUTOR_SYSTEM_PROMPT},
                    *history,
                    {"role": "user", "content": question},
                ]
            )
            return AIAnswer(answer=answer, steps=[])
        except QwenUnavailableError:
            return AIAnswer(
                answer=(
                    "I couldn't reach the AI model to answer that, and it isn't one of "
                    "the few kinematics/projectile/force calculations the offline "
                    "fallback can handle on its own. Check that QWEN_API_KEY is set "
                    "correctly in the backend's .env and try again."
                ),
                steps=[],
            )

    # 2) Physics Solver / Tools — verified calculation, never left to the LLM.
    tool_result = _run_tool(tool_name, tool_args)
    steps = tool_result.get("steps", [])

    # 3) Explanation step — ask Qwen to narrate the verified result; fall back to steps.
    try:
        explanation = await chat_completion(
            [
                {"role": "system", "content": EXPLANATION_SYSTEM_PROMPT},
                *history,
                {
                    "role": "user",
                    "content": f"Question: {question}\nVerified result: {tool_result['result']}\nSteps: {steps}",
                },
            ]
        )
    except QwenUnavailableError:
        result_str = ", ".join(f"{k} = {v:.4g}" if isinstance(v, float) else f"{k} = {v}" for k, v in tool_result["result"].items())
        explanation = "Here's the step-by-step solution:\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps)) + f"\n\nFinal answer: {result_str}"

    # 4) Visualization Data — structured payload for the React Native app.
    visualization = _build_visualization(tool_name, tool_result)

    return AIAnswer(answer=explanation, steps=steps, visualization=visualization)
