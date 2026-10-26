# Hydraulic-jump verification

CPU full SWE, triangular meshes, first and second order, free-slip walls, Cs=0. Stationary and upstream-moving jumps, a tangential-flow oblique jump, and a wall-reflected bore are compared with independent mass/momentum jump relations. The exact states use g=9.80665m/s2, upstream depth0.03m and normal speed1.7m/s. No hydraulic software supplies a reference.

Each case runs1s with0.1s outputs; the reference is assessed at0.5s in the declared central window. The outer solid-wall disturbances are outside its causal domain. Global closed volume is checked separately. The two orientations rotate both geometry and velocities; they are accuracy checks, not an assumption of exact second-order rotational invariance.

| Case | Verdict | Depth relative L1 | Front position (m) | Momentum jump residual |
|---|---|---:|---:|---:|
| stationary-angle0-order1 | PASS | 0.00950254 | -0.00229318 | 8.11884e-06 |
| stationary-angle0-order2 | PASS | 0.00362789 | -0.000881387 | 0.00728259 |
| stationary-angle64-order1 | PASS | 0.00950254 | -0.00229318 | 8.11884e-06 |
| stationary-angle64-order2 | PASS | 0.00373106 | -0.000805675 | 0.0069128 |
| moving-upstream-angle0-order1 | PASS | 0.00961487 | -0.152665 | 0.000295491 |
| moving-upstream-angle0-order2 | PASS | 0.0231852 | -0.151126 | 0.0184615 |
| moving-upstream-angle64-order1 | PASS | 0.00961509 | -0.152665 | 0.000295508 |
| moving-upstream-angle64-order2 | PASS | 0.022033 | -0.151132 | 0.0172145 |
| oblique-angle0-order1 | PASS | 0.0130955 | -0.00220957 | 0.00580601 |
| oblique-angle0-order2 | PASS | 0.00350995 | -0.000739649 | 0.00455884 |
| oblique-angle64-order1 | PASS | 0.0130906 | -0.00220972 | 0.00579882 |
| oblique-angle64-order2 | PASS | 0.00478489 | -0.000398484 | 8.54211e-05 |
| wall-angle0-order1 | PASS | 0.0274754 | -0.209335 | 0.000513865 |
| wall-angle0-order2 | PASS | 0.0490179 | -0.209193 | 0.00937938 |
| wall-angle64-order1 | PASS | 0.0274778 | -0.209335 | 0.000521758 |
| wall-angle64-order2 | PASS | 0.0478469 | -0.208896 | 0.00926725 |

The frozen geometry, window and criteria are in [plan.json](plan.json). Full case inputs, references, binary identities, saved fields and metrics are retained. Passing these tests does not establish measured accuracy or the correct jump position in UK Test6. The canonical UK corpus and its anchors are never modified.
