"""Deterministic physics calculation tools.

Per the plan's Phase 5 rule: "The AI should not be responsible for every
numerical calculation by itself." Qwen calls into these functions for
anything numeric; they return exact (SymPy-verified) results instead of
whatever numbers the language model might hallucinate.

Each `solve_*` function returns a plain dict: {"result": ..., "unit": ...,
"steps": [...]} so it can be dropped straight into an AI explanation and/or
a visualization payload.
"""
from __future__ import annotations

import numpy as np
import sympy as sp

# ---------------------------------------------------------------------------
# 1D Kinematics:  x = x0 + v0*t + 1/2*a*t^2   and   v = v0 + a*t
# Pass `solve_for` (one of "x", "v0", "v", "a", "t") plus enough of the other
# values as knowns to pin it down; the solver picks whichever equation(s)
# only involve known quantities plus the target, solves symbolically, then
# returns a numeric result. Values you don't know (and aren't solving for)
# should simply be omitted.
# ---------------------------------------------------------------------------
def solve_kinematics(
    *,
    solve_for: str,
    x0: float = 0.0,
    x: float | None = None,
    v0: float | None = None,
    v: float | None = None,
    a: float | None = None,
    t: float | None = None,
) -> dict:
    X0, X, V0, V, A, T = sp.symbols("x0 x v0 v a t", real=True)
    name_to_symbol = {"x0": X0, "x": X, "v0": V0, "v": V, "a": A, "t": T}

    if solve_for not in name_to_symbol or solve_for == "x0":
        raise ValueError('solve_for must be one of "x", "v0", "v", "a", "t"')
    target = name_to_symbol[solve_for]

    known: dict[sp.Symbol, float] = {X0: x0}
    for sym, val in [(X, x), (V0, v0), (V, v), (A, a), (T, t)]:
        if val is not None and sym is not target:
            known[sym] = val

    eq1 = sp.Eq(X, X0 + V0 * T + sp.Rational(1, 2) * A * T**2)
    eq2 = sp.Eq(V, V0 + A * T)

    # Only keep equations whose every symbol besides the target is already known.
    usable_eqs = [e for e in (eq1, eq2) if set(e.free_symbols) - set(known) - {target} == set()]
    if not usable_eqs:
        raise ValueError(
            f"Not enough known values to solve for {solve_for}. "
            f"Provide enough of x0, x, v0, v, a, t."
        )

    eqs = [e.subs(known) for e in usable_eqs]
    solutions = sp.solve(eqs, target, dict=True)
    if not solutions:
        raise ValueError("No solution found for the given kinematics inputs.")

    value = sp.nsimplify(solutions[0][target])
    numeric_value = float(sp.N(value))

    return {
        "result": {solve_for: numeric_value},
        "unit": {"x": "m", "v": "m/s", "v0": "m/s", "a": "m/s^2", "t": "s"}.get(solve_for),
        "steps": [
            r"Equations available: $x = x_0 + v_0 t + \frac{1}{2} a t^2$ and $v = v_0 + a t$",
            f"Known values: {', '.join(f'{k}={v_}' for k, v_ in known.items())}",
            f"Solved for {solve_for}: ${solve_for} = {sp.latex(sp.simplify(value))} \\approx {numeric_value:.4g}$",
        ],
    }


# ---------------------------------------------------------------------------
# Projectile motion (no air resistance): given launch speed and angle,
# returns time of flight, max height, and range, plus a sampled trajectory
# usable directly for a "motion diagram" / graph visualization.
# ---------------------------------------------------------------------------
def solve_projectile_motion(*, v0: float, angle_deg: float, g: float = 9.81, n_samples: int = 30) -> dict:
    theta = np.radians(angle_deg)
    vx0 = v0 * np.cos(theta)
    vy0 = v0 * np.sin(theta)

    t_flight = 2 * vy0 / g if vy0 > 0 else 0.0
    max_height = (vy0**2) / (2 * g) if vy0 > 0 else 0.0
    range_ = vx0 * t_flight

    ts = np.linspace(0, t_flight, max(n_samples, 2)) if t_flight > 0 else np.array([0.0])
    xs = vx0 * ts
    ys = vy0 * ts - 0.5 * g * ts**2

    return {
        "result": {
            "time_of_flight_s": float(t_flight),
            "max_height_m": float(max_height),
            "range_m": float(range_),
        },
        "trajectory": {"t": ts.tolist(), "x": xs.tolist(), "y": ys.tolist()},
        "steps": [
            rf"$v_{{x0}} = v_0 \cos\theta = {vx0:.4g}$ m/s, $v_{{y0}} = v_0 \sin\theta = {vy0:.4g}$ m/s",
            rf"Time of flight: $t = \dfrac{{2 v_{{y0}}}}{{g}} \approx {t_flight:.4g}$ s",
            rf"Max height: $h = \dfrac{{v_{{y0}}^2}}{{2g}} \approx {max_height:.4g}$ m",
            rf"Range: $R = v_{{x0}} \cdot t \approx {range_:.4g}$ m",
        ],
    }


# ---------------------------------------------------------------------------
# Newton's second law: sum of forces (vectors as (fx, fy) tuples) = m*a
# ---------------------------------------------------------------------------
def solve_net_force(*, forces: list[tuple[float, float]], mass: float) -> dict:
    if mass <= 0:
        raise ValueError("mass must be positive")

    fx = sum(f[0] for f in forces)
    fy = sum(f[1] for f in forces)
    net = np.array([fx, fy])
    magnitude = float(np.linalg.norm(net))
    angle_deg = float(np.degrees(np.arctan2(fy, fx))) if magnitude > 0 else 0.0
    acceleration = magnitude / mass

    return {
        "result": {
            "net_force_N": magnitude,
            "net_force_angle_deg": angle_deg,
            "acceleration_m_s2": acceleration,
        },
        "components": {"fx": fx, "fy": fy},
        "steps": [
            rf"Sum forces component-wise: $F_x = {fx:.4g}$ N, $F_y = {fy:.4g}$ N",
            rf"$|F_{{net}}| = \sqrt{{F_x^2 + F_y^2}} \approx {magnitude:.4g}$ N at ${angle_deg:.4g}°$",
            rf"$a = \dfrac{{F_{{net}}}}{{m}} = \dfrac{{{magnitude:.4g}}}{{{mass:.4g}}} \approx {acceleration:.4g}$ m/s²",
        ],
    }


# Registry the AI service can dispatch into by tool name.
TOOLS = {
    "solve_kinematics": solve_kinematics,
    "solve_projectile_motion": solve_projectile_motion,
    "solve_net_force": solve_net_force,
}
