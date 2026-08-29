# Visualization JSON Format (Phase 6)

Every AI answer (`POST /api/v1/ai/ask`) may include a `visualization` object:

```json
{
  "type": "motion_diagram | graph | free_body_diagram | circuit | wave | vector_field",
  "data": { "...": "renderer-specific payload" }
}
```

The mobile app picks a renderer component by `type` and hands it `data` as-is.
Backend source of truth: `app/services/ai_service.py::_build_visualization`
and `app/schemas/chat.py::VisualizationPayload`.

## Implemented today

### `motion_diagram` (from `solve_projectile_motion`)
```json
{ "type": "motion_diagram", "data": { "t": [0, 0.1, ...], "x": [0, 0.5, ...], "y": [0, 0.4, ...] } }
```
Render as an animated/scrubbable path plot (x vs y over t).

### `graph` (from `solve_kinematics`)
```json
{ "type": "graph", "data": { "kind": "kinematics", "v": 12.4 } }
```
Render as a labeled result card or simple bar/line depending on `kind`.

### `free_body_diagram` (from `solve_net_force`)
```json
{
  "type": "free_body_diagram",
  "data": {
    "components": { "fx": 3.0, "fy": 4.0 },
    "result": { "net_force_N": 5.0, "net_force_angle_deg": 53.13, "acceleration_m_s2": 2.5 }
  }
}
```
Render as force vectors from a center point, one arrow per input force plus
the resultant.

## Reserved for later (not yet produced by the backend)
- `circuit` — nodes/edges of resistors, sources, meters (for electric circuits).
- `wave` — amplitude/frequency/phase for waveform plotting.
- `vector_field` — a grid of vectors (e.g. E-field, B-field).

Add a new type by: (1) adding a `solve_*` tool in `physics_solver.py`, (2)
mapping its result to a `type`/`data` shape in `_build_visualization`, (3)
building the matching renderer component in `mobile/components/visualizations/`.
