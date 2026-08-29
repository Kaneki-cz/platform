"""Seeds Subjects (Physics/Chemistry/Biology) with a few real courses and
lessons under Physics, so the app has something to show in the
Home/Courses/Lessons screens. Chemistry and Biology are created empty,
ready for instructors to add their own content (see app/db/make_admin.py
and the in-app "Manage Content" screens).

Idempotent: safe to run more than once — it skips any subject/course whose
name already exists instead of creating duplicates. If you're upgrading an
existing database that predates Subjects, run
`python -m app.db.migrate_v2_subjects` first.

Usage:
    python -m app.db.seed
"""
from app.db.database import Base, SessionLocal, engine
from app.models import *  # noqa: F401,F403 — register metadata
from app.models.course import Course
from app.models.lesson import Lesson
from app.models.subject import Subject

PHYSICS_COURSES = [
    {
        "title": "Mechanics",
        "description": "Motion, forces, energy, and momentum — the foundation of classical physics.",
        "grade_level": "Grade 10",
        "order_index": 1,
        "lessons": [
            {
                "title": "Introduction to Motion",
                "content": (
                    "Motion is a change in an object's position over time, described using "
                    "position, displacement, velocity, and acceleration.\n\n"
                    "Displacement is the change in position (a vector — it has direction), "
                    "while distance is how much ground was covered (a scalar). Average "
                    "velocity is displacement divided by time, v = Δx / Δt, while average "
                    "speed is distance divided by time. Acceleration is the rate of change "
                    "of velocity, a = Δv / Δt.\n\n"
                    "For motion with constant acceleration, three equations tie everything "
                    "together: v = v0 + at, x = x0 + v0t + ½at², and v² = v0² + 2a(x − x0). "
                    "Try the AI Assistant with a question like \"An object starts at rest and "
                    "accelerates at 3 m/s² for 5 seconds, what is its final velocity?\" to see "
                    "these equations solved step by step."
                ),
            },
            {
                "title": "Newton's Laws of Motion",
                "content": (
                    "Newton's First Law (inertia): an object at rest stays at rest, and an "
                    "object in motion stays in motion at constant velocity, unless acted on "
                    "by a net external force.\n\n"
                    "Newton's Second Law: the net force on an object equals its mass times "
                    "its acceleration, F = ma. This is the single most useful equation in "
                    "mechanics — it connects forces (the cause) to acceleration (the effect).\n\n"
                    "Newton's Third Law: for every action force, there is an equal and "
                    "opposite reaction force. If you push on a wall, the wall pushes back on "
                    "you with the same magnitude of force."
                ),
            },
            {
                "title": "Work, Energy, and Power",
                "content": (
                    "Work is done when a force causes displacement: W = F·d·cos(θ), measured "
                    "in joules.\n\n"
                    "Kinetic energy (energy of motion) is KE = ½mv². Gravitational potential "
                    "energy (stored energy due to height) is PE = mgh. The work-energy "
                    "theorem says the net work done on an object equals its change in "
                    "kinetic energy.\n\n"
                    "In an isolated system with no friction, total mechanical energy "
                    "(KE + PE) is conserved — energy changes form but the total stays "
                    "constant. Power is the rate of doing work, P = W / t, measured in watts."
                ),
            },
            {
                "title": "Momentum and Collisions",
                "content": (
                    "Momentum is p = mv — mass times velocity, a vector quantity.\n\n"
                    "The law of conservation of momentum: in a closed system with no "
                    "external forces, total momentum before a collision equals total "
                    "momentum after. This holds whether the collision is elastic (kinetic "
                    "energy is also conserved, like billiard balls) or inelastic (kinetic "
                    "energy is lost to heat/sound/deformation, like a car crash).\n\n"
                    "Impulse (J = FΔt) equals the change in momentum — this is why airbags "
                    "and crumple zones work: they extend the collision time to reduce the "
                    "peak force."
                ),
            },
        ],
    },
    {
        "title": "Electricity and Magnetism",
        "description": "Electric charge, circuits, and magnetic fields — how electromagnetism shapes technology.",
        "grade_level": "Grade 11",
        "order_index": 2,
        "lessons": [
            {
                "title": "Electric Charge and Coulomb's Law",
                "content": (
                    "Electric charge comes in two types, positive and negative; like charges "
                    "repel, opposite charges attract.\n\n"
                    "Coulomb's Law gives the force between two point charges: "
                    "F = k·|q1·q2| / r², where k ≈ 8.99 × 10⁹ N·m²/C² and r is the distance "
                    "between them. The force follows an inverse-square law, just like "
                    "gravity — double the distance, and the force drops to a quarter."
                ),
            },
            {
                "title": "Electric Circuits and Ohm's Law",
                "content": (
                    "Ohm's Law: V = IR — voltage equals current times resistance.\n\n"
                    "In a series circuit, current is the same everywhere and voltages add up "
                    "across components. In a parallel circuit, voltage is the same across "
                    "each branch and currents add up. Electrical power is P = IV = I²R = V²/R."
                ),
            },
            {
                "title": "Magnetic Fields and Forces",
                "content": (
                    "Moving electric charges create magnetic fields, and magnetic fields "
                    "exert forces on moving charges — this is the basis of electric motors "
                    "and generators.\n\n"
                    "The force on a charge moving through a magnetic field is "
                    "F = qvB·sin(θ), always perpendicular to both the velocity and the "
                    "field. A current-carrying wire in a magnetic field feels a force too: "
                    "F = BIL·sin(θ)."
                ),
            },
        ],
    },
    {
        "title": "Waves and Optics",
        "description": "How waves travel, interfere, and carry energy — from sound to light.",
        "grade_level": "Grade 12",
        "order_index": 3,
        "lessons": [
            {
                "title": "Properties of Waves",
                "content": (
                    "A wave transfers energy without transferring matter. Key properties: "
                    "wavelength (λ, distance between repeating points), frequency "
                    "(f, cycles per second, in Hz), amplitude (maximum displacement), and "
                    "speed (v = fλ).\n\n"
                    "Transverse waves oscillate perpendicular to the direction of travel "
                    "(like light or a wave on a string); longitudinal waves oscillate "
                    "parallel to the direction of travel (like sound)."
                ),
            },
            {
                "title": "Sound Waves",
                "content": (
                    "Sound is a longitudinal pressure wave that needs a medium (air, water, "
                    "solid) to travel — unlike light, it cannot travel through a vacuum.\n\n"
                    "The speed of sound in air is about 343 m/s at room temperature. The "
                    "Doppler effect explains why a siren sounds higher-pitched approaching "
                    "and lower-pitched moving away: the observed frequency shifts based on "
                    "the relative motion between source and observer."
                ),
            },
            {
                "title": "Reflection and Refraction of Light",
                "content": (
                    "The law of reflection: the angle of incidence equals the angle of "
                    "reflection, measured from the normal (a line perpendicular to the "
                    "surface).\n\n"
                    "Refraction is the bending of light as it passes between media of "
                    "different densities, described by Snell's Law: n1·sin(θ1) = n2·sin(θ2), "
                    "where n is the refractive index of each medium. This is why a straw "
                    "looks bent in a glass of water."
                ),
            },
        ],
    },
]

# Subjects to make sure exist. Physics comes with the real courses/lessons
# above; Chemistry and Biology start empty — assign an instructor to them
# (via the admin "Manage Content" screens, or POST /api/v1/subjects/{id}/instructors)
# and they can add their own chapters/lectures from inside the app.
SUBJECTS = [
    {"name": "Physics", "order_index": 1, "courses": PHYSICS_COURSES},
    {"name": "Chemistry", "order_index": 2, "courses": []},
    {"name": "Biology", "order_index": 3, "courses": []},
]


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        created_subjects = 0
        created_courses = 0
        created_lessons = 0

        for subject_data in SUBJECTS:
            subject = db.query(Subject).filter(Subject.name == subject_data["name"]).first()
            if subject:
                print(f"Subject already exists, skipping creation: {subject_data['name']}")
            else:
                subject = Subject(name=subject_data["name"], order_index=subject_data["order_index"])
                db.add(subject)
                db.flush()  # get subject.id before creating courses
                created_subjects += 1

            for course_data in subject_data["courses"]:
                existing = (
                    db.query(Course)
                    .filter(Course.subject_id == subject.id, Course.title == course_data["title"])
                    .first()
                )
                if existing:
                    print(f"  Skipping (already exists): {course_data['title']}")
                    continue

                course = Course(
                    subject_id=subject.id,
                    title=course_data["title"],
                    description=course_data["description"],
                    grade_level=course_data["grade_level"],
                    order_index=course_data["order_index"],
                )
                db.add(course)
                db.flush()  # get course.id before creating lessons
                created_courses += 1

                for i, lesson_data in enumerate(course_data["lessons"], start=1):
                    db.add(
                        Lesson(
                            course_id=course.id,
                            title=lesson_data["title"],
                            content=lesson_data["content"],
                            order_index=i,
                        )
                    )
                    created_lessons += 1

        db.commit()
        print(
            f"Done. Created {created_subjects} subject(s), {created_courses} course(s), "
            f"{created_lessons} lesson(s)."
        )
    finally:
        db.close()


if __name__ == "__main__":
    seed()
