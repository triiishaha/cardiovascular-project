"""Procedural 3D human heart -> heart.glb  (Track A: Cardiovascular Risk Visualization)

Everything is generated from code (signed-distance shapes + marching cubes), so the model is
original, licence-free and reproducible.  It is a *stylised anatomical* model, not a CT scan.

Output scene (each name is a separate glTF node with its own material):
    Ventricles, Atria, Aorta, PulmonaryTrunk, SVC, IVC, PulmonaryVeins
    LAD, LCX, RCA          <- coronary arteries; recolour these from model probabilities

Orientation: Y up, +Z = anterior (front of the patient, towards the camera in a front view),
+X = the patient's left.  Units: 1 unit ~ 10 cm (the heart is ~1.4 units tall).

Usage:  python make_heart_glb.py [out.glb]
Needs:  pip install -r scripts/requirements_3d.txt

Three.js example - colour each artery from a predicted probability (green -> amber -> red):
    const gltf = await new GLTFLoader().loadAsync('heart.glb');
    const prob = {LAD: 0.88, LCX: 0.16, RCA: 0.63};            // from predict_patient()
    gltf.scene.traverse(o => {
      if (o.isMesh && o.name in prob)                           // each artery has its own material
        o.material.color.setHSL((1 - prob[o.name]) * 0.33, 0.85, 0.5);   // 0.33 = green, 0 = red
    });
Node extras: {"coronaryArtery": true, "vessel": "LAD"} on the three arteries (use for click picking).
"""
import sys

import numpy as np
import trimesh
from skimage.measure import marching_cubes

OUT = sys.argv[1] if len(sys.argv) > 1 else "heart.glb"
STEP = 0.11          # marching-cubes voxel size in cm (smaller = smoother, bigger file)
SCALE = 0.1          # cm -> scene units


# --------------------------------------------------------------------------- SDF helpers
def smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def ellipsoid(p, c, r, egg=0.0, apex=0.0):
    """Approximate signed distance to an ellipsoid; `egg` makes the +Y end wider than the -Y end,
    `apex` pinches the -Y end into a cone-like tip."""
    c, r = np.asarray(c, np.float32), np.asarray(r, np.float32)
    d = p - c
    yn = np.clip(d[:, 1] / r[1], -1, 1)
    s = (1.0 + egg * yn) * (1.0 - apex * np.maximum(-yn, 0) ** 2)
    q = np.stack([d[:, 0] / (r[0] * s), d[:, 1] / r[1], d[:, 2] / (r[2] * s)], 1)
    return (np.linalg.norm(q, axis=1) - 1.0) * float(min(r))


def catmull(points, n):
    """Catmull-Rom spline through points, sampled at n points."""
    P = np.asarray(points, np.float64)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    m = len(P) - 3
    for t in np.linspace(0, m, n):
        i = min(int(t), m - 1)
        u = t - i
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u ** 2
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


def tube_sdf(p, path, radii):
    """Signed distance to a variable-radius tube along a polyline."""
    best = np.full(len(p), 1e9, np.float32)
    for i in range(len(path) - 1):
        a, b = path[i].astype(np.float32), path[i + 1].astype(np.float32)
        ab = b - a
        t = np.clip(((p - a) @ ab) / (ab @ ab + 1e-9), 0, 1)
        proj = a + t[:, None] * ab
        r = radii[i] + t * (radii[i + 1] - radii[i])
        best = np.minimum(best, np.linalg.norm(p - proj, axis=1) - r)
    return best


def tube_part(points, radii_ctrl, n=60):
    path = catmull(points, n)
    rc = np.asarray(radii_ctrl, np.float64)
    radii = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(rc)), rc)
    return path, radii


# --------------------------------------------------------------------------- heart shapes
# Local frame: +Y = long axis towards the base, +X = patient's left, +Z = anterior.
def ventricles(p):
    lv = ellipsoid(p, (0.7, -0.4, -0.3), (2.85, 5.0, 2.7), egg=0.12, apex=0.55)
    rv = ellipsoid(p, (-2.3, 0.4, 1.1), (2.5, 4.0, 2.2), egg=0.08, apex=0.45)
    return smin(lv, rv, 0.4)


def atria(p):
    ra = ellipsoid(p, (-2.9, 3.7, -0.2), (1.9, 2.5, 1.9), egg=0.0)
    la = ellipsoid(p, (1.1, 4.4, -2.3), (2.7, 1.6, 1.6))
    raa = ellipsoid(p, (-1.4, 5.5, 1.5), (1.3, 1.0, 1.0))   # right auricle (wraps the aorta)
    laa = ellipsoid(p, (2.9, 4.9, 0.9), (1.0, 1.15, 0.8))   # left auricle
    return smin(smin(ra, la, 0.6), smin(raa, laa, 0.4), 0.5)


AORTA_PATH = [(-0.1, 4.2, -0.2), (-0.2, 5.6, -0.1), (-0.4, 7.2, -0.2), (0.1, 8.6, -0.6),
              (1.3, 9.2, -1.2), (2.4, 8.5, -1.8), (2.6, 7.0, -2.3), (2.6, 5.2, -2.5)]
AORTA_R = [1.45, 1.25, 1.12, 1.05, 1.0, 0.95, 0.92, 0.9]
PT_PATH = [(0.45, 4.1, 1.5), (0.8, 5.3, 1.1), (1.0, 6.3, 0.3)]
PT_R = [1.25, 1.15, 1.05]


def build_vessel_fields():
    fields = {}
    ap, ar = tube_part(AORTA_PATH, AORTA_R, 70)
    branches = [  # brachiocephalic, left carotid, left subclavian
        ([(-0.2, 8.7, -0.55), (-0.5, 9.8, -0.5), (-0.9, 10.6, -0.4)], [0.55, 0.5, 0.45]),
        ([(0.5, 8.95, -0.85), (0.5, 9.9, -0.85), (0.5, 10.5, -0.8)], [0.4, 0.38, 0.35]),
        ([(1.5, 9.1, -1.2), (1.9, 9.8, -1.3), (2.4, 10.3, -1.3)], [0.45, 0.43, 0.4]),
    ]
    aorta = [(ap, ar)] + [tube_part(pts, rr, 20) for pts, rr in branches]
    pp, pr = tube_part(PT_PATH, PT_R, 30)
    pa_r = tube_part([(1.0, 6.3, 0.3), (0.1, 6.6, -1.2), (-1.4, 6.8, -2.2), (-3.0, 6.7, -2.4)],
                     [0.85, 0.75, 0.7, 0.65], 30)
    pa_l = tube_part([(1.0, 6.3, 0.3), (2.2, 6.6, -0.7), (3.4, 6.4, -1.5), (4.2, 6.0, -2.1)],
                     [0.85, 0.75, 0.7, 0.65], 30)
    pulm_trunk = [(pp, pr), pa_r, pa_l]
    svc = [tube_part([(-2.8, 5.0, -0.1), (-2.9, 7.2, -0.3), (-2.9, 9.4, -0.5)], [1.0, 0.9, 0.85], 30)]
    ivc = [tube_part([(-2.8, 2.2, -0.9), (-2.7, 0.6, -1.2), (-2.5, -0.9, -1.4)], [1.05, 1.0, 0.95], 20)]
    vr = [0.5, 0.46, 0.44]
    veins = [
        tube_part([(0.3, 4.5, -2.7), (-1.2, 4.9, -3.2), (-2.5, 5.1, -3.5)], vr, 20),
        tube_part([(0.3, 3.9, -2.7), (-1.2, 3.7, -3.2), (-2.5, 3.5, -3.5)], vr, 20),
        tube_part([(2.0, 4.7, -2.6), (3.2, 5.0, -3.0), (4.0, 5.2, -3.2)], vr, 20),
        tube_part([(2.0, 3.9, -2.6), (3.2, 3.7, -3.0), (4.0, 3.5, -3.2)], vr, 20),
    ]
    fields["Aorta"] = aorta
    fields["PulmonaryTrunk"] = pulm_trunk
    fields["SVC"] = svc
    fields["IVC"] = ivc
    fields["PulmonaryVeins"] = veins
    return fields


def union_tubes(p, tubes, k=0.35):
    d = None
    for path, radii in tubes:
        t = tube_sdf(p, path, radii)
        d = t if d is None else smin(d, t, k)
    return d


# --------------------------------------------------------------------------- meshing
def make_grid(lo, hi, step):
    xs = np.arange(lo[0], hi[0], step, dtype=np.float32)
    ys = np.arange(lo[1], hi[1], step, dtype=np.float32)
    zs = np.arange(lo[2], hi[2], step, dtype=np.float32)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
    pts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
    return pts, (len(xs), len(ys), len(zs)), np.array(lo, np.float32)


def mesh_from_field(fn, lo, hi, step=STEP, smooth=12):
    pts, shape, origin = make_grid(lo, hi, step)
    vol = fn(pts).reshape(shape)
    verts, faces, _, _ = marching_cubes(vol, level=0.0, spacing=(step,) * 3)
    m = trimesh.Trimesh(verts + origin, faces, process=True)
    if m.volume < 0:
        m.invert()
    trimesh.smoothing.filter_taubin(m, iterations=smooth)
    return m


def world_transform(centre):
    """Local (long-axis) frame -> scene frame: apex down & to the patient's left, centred, scaled to scene units."""
    Rz = trimesh.transformations.rotation_matrix(np.radians(40.0), [0, 0, 1])
    Rx = trimesh.transformations.rotation_matrix(np.radians(-9.0), [1, 0, 0])
    S = np.diag([SCALE, SCALE, SCALE, 1.0])
    return S @ Rz @ Rx @ trimesh.transformations.translation_matrix(-np.asarray(centre))


def heart_field(p):
    """Combined ventricles + atria (used for placing arteries on the surface)."""
    return smin(ventricles(p), atria(p), 0.5)



# --------------------------------------------------------------------------- coronary arteries
def _grad(F, P, eps=0.03):
    g = np.zeros_like(P)
    for i in range(3):
        d = np.zeros(3, np.float32)
        d[i] = eps
        g[:, i] = (F(P + d) - F(P - d)) / (2 * eps)
    return g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-9)


def snap(path, offset=0.06, iters=16):
    """Slide points onto the heart surface (slightly proud of it so the tube is half embedded)."""
    P = path.astype(np.float32).copy()
    for _ in range(iters):
        d = heart_field(P)
        P -= 0.7 * (d - offset)[:, None] * _grad(heart_field, P)
    return P


def smooth(path, w=9, passes=2):
    P = path.copy()
    k = np.ones(w) / w
    for _ in range(passes):
        pad = np.vstack([np.repeat(P[:1], w // 2, 0), P, np.repeat(P[-1:], w // 2, 0)])
        Q = np.stack([np.convolve(pad[:, i], k, mode="valid") for i in range(3)], 1)
        Q[0], Q[-1] = P[0], P[-1]
        P = Q
    return P


def surface_path(waypoints, n=90, offset=0.06, w=9, passes=2):
    P = catmull(waypoints, n)
    P = snap(P, offset)
    P = smooth(P, w, passes)
    return snap(P, offset, iters=6)


def tube_mesh(path, radii, nseg=14):
    n = len(path)
    T = np.gradient(path, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    N = np.cross(T[0], [0.3, 0.9, 0.3])
    N /= np.linalg.norm(N)
    verts, frames = [], []
    for i in range(n):
        N = N - np.dot(N, T[i]) * T[i]
        N /= np.linalg.norm(N)
        B = np.cross(T[i], N)
        frames.append((N, B))
        for a in np.linspace(0, 2 * np.pi, nseg, endpoint=False):
            verts.append(path[i] + radii[i] * (np.cos(a) * N + np.sin(a) * B))
    faces = []
    for i in range(n - 1):
        for j in range(nseg):
            a, b = i * nseg + j, i * nseg + (j + 1) % nseg
            c, d = (i + 1) * nseg + j, (i + 1) * nseg + (j + 1) % nseg
            faces += [[a, c, b], [b, c, d]]
    verts = np.array(verts)
    # round the two ends
    v0, v1 = len(verts), len(verts) + 1
    verts = np.vstack([verts, path[0] - T[0] * radii[0] * 0.6, path[-1] + T[-1] * radii[-1] * 0.6])
    for j in range(nseg):
        faces.append([v0, j, (j + 1) % nseg])
        o = (n - 1) * nseg
        faces.append([v1, o + (j + 1) % nseg, o + j])
    m = trimesh.Trimesh(verts, faces, process=False)
    trimesh.repair.fix_normals(m)
    return m


def taper(n, r0, r1, r_end=None, power=1.0):
    t = np.linspace(0, 1, n) ** power
    r = r0 + (r1 - r0) * t
    if r_end is not None:
        r = np.where(t > 0.85, r * (1 - (t - 0.85) / 0.15 * (1 - r_end)), r)
    return r


def branch(parent, f, waypoints, r0, r1, n=45):
    i = int(f * (len(parent) - 1))
    P = surface_path([parent[i]] + list(waypoints), n=n)
    return P, taper(n, r0, r1, 0.35)


def build_arteries():
    out = {}
    # ---- LAD: left main -> anterior interventricular groove -> apex
    lm = catmull([(1.15, 4.8, 0.1), (1.6, 4.7, 0.6), (1.95, 4.55, 1.2)], 20)
    lad = surface_path([(1.95, 4.55, 1.2), (1.1, 4.1, 1.8), (0.2, 3.5, 2.1), (-0.3, 2.5, 2.4), (-0.35, 1.0, 2.6),
                        (-0.3, -0.5, 2.4), (-0.1, -2.0, 1.9), (0.2, -3.3, 1.3), (0.5, -4.5, 0.6)], n=110)
    parts = [(lm, taper(20, 0.26, 0.24)), (lad, taper(110, 0.24, 0.1, 0.4))]
    parts.append(branch(lad, 0.22, [(1.6, 2.6, 2.1), (2.4, 1.2, 1.9)], 0.13, 0.07))
    parts.append(branch(lad, 0.45, [(1.7, 0.3, 2.1), (2.5, -1.2, 1.5)], 0.12, 0.06))
    parts.append(branch(lad, 0.65, [(1.2, -1.4, 1.9), (1.8, -3.0, 1.0)], 0.1, 0.05))
    out["LAD"] = parts
    # ---- LCX: under the left auricle, around the left AV groove to the back
    lcx = surface_path([(1.95, 4.55, 1.2), (2.7, 4.0, 1.0), (3.3, 3.4, 0.1), (3.2, 3.1, -1.1), (2.5, 3.0, -2.2),
                        (1.3, 3.0, -3.0), (0.2, 3.0, -3.3)], n=100)
    parts = [(lm, taper(20, 0.26, 0.24)), (lcx, taper(100, 0.22, 0.08, 0.4))]
    parts.append(branch(lcx, 0.38, [(3.7, 1.8, -0.3), (3.7, 0.3, -0.9)], 0.13, 0.06))
    parts.append(branch(lcx, 0.62, [(3.4, 1.2, -1.9), (3.0, -0.8, -2.0)], 0.12, 0.06))
    out["LCX"] = parts
    # ---- RCA: right AV groove, round the right border, crux, posterior descending artery
    rca = surface_path([(-1.3, 4.8, 0.2), (-1.8, 4.5, 1.4), (-2.9, 3.7, 2.0), (-4.0, 2.6, 1.4), (-4.6, 1.8, 0.3),
                        (-4.3, 2.0, -1.2), (-3.2, 2.7, -2.3), (-1.9, 3.1, -3.1), (-0.9, 3.2, -3.4)], n=120, w=31, passes=5)
    pda = surface_path([(-0.9, 3.2, -3.4), (-0.5, 1.6, -3.3), (-0.2, -0.6, -3.1), (0.2, -2.6, -2.6), (0.4, -4.0, -1.6)], n=60, w=11)
    parts = [(rca, taper(120, 0.24, 0.13)), (pda, taper(60, 0.13, 0.07, 0.4))]
    parts.append(branch(rca, 0.30, [(-4.2, 0.2, 1.4), (-3.9, -1.8, 1.7)], 0.13, 0.06))
    out["RCA"] = parts
    return out


ARTERY_SCALE = 1.5   # real coronaries are ~0.4 cm wide; exaggerated so they are visible and clickable


def merge_tubes(parts):
    return trimesh.util.concatenate([tube_mesh(P, r * ARTERY_SCALE) for P, r in parts])


def build_body_meshes():
    parts = {}
    parts["Ventricles"] = mesh_from_field(ventricles, (-5.2, -6.2, -4.2), (4.6, 5.6, 4.2))
    parts["Atria"] = mesh_from_field(atria, (-5.2, 1.5, -5.0), (5.4, 7.2, 3.6))
    for name, tubes in build_vessel_fields().items():
        pts = np.vstack([t[0] for t in tubes])
        lo = pts.min(0) - 2.0
        hi = pts.max(0) + 2.0
        parts[name] = mesh_from_field(lambda p, tb=tubes: union_tubes(p, tb), lo, hi, step=0.09)
    return parts


# --------------------------------------------------------------------------- colours & export
def srgb(hexstr):
    """'#rrggbb' -> linear RGB (glTF stores linear values)."""
    c = np.array([int(hexstr[i:i + 2], 16) for i in (1, 3, 5)]) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


PALETTE = {  # sRGB, intuitive colours
    "Ventricles": "#a5504a", "Atria": "#8e5058", "Aorta": "#cf5d52", "PulmonaryTrunk": "#4a66b5",
    "SVC": "#4f5aa8", "IVC": "#4f5aa8", "PulmonaryVeins": "#c0504a",
}
ARTERY_COLORS = {"LAD": "#ee2a22", "LCX": "#4cd04a", "RCA": "#e6b422"}   # default colours; the app can recolour them from model output
FAT = "#e2c27a"              # epicardial fat that hugs the coronary arteries
ROUGH = {"Ventricles": 0.5, "Atria": 0.55, "Aorta": 0.45, "PulmonaryTrunk": 0.45, "SVC": 0.5, "IVC": 0.5,
         "PulmonaryVeins": 0.5}
TARGET_FACES = {"Ventricles": 34000, "Atria": 16000, "Aorta": 15000, "PulmonaryTrunk": 11000,
                "SVC": 4500, "IVC": 4500, "PulmonaryVeins": 9000}


def decimate(m, target):
    if len(m.faces) <= target:
        return m
    return m.simplify_quadric_decimation(face_count=target)


def muscle_tone(mesh):
    """Subtle per-vertex brightness variation (0.86-1.0). The real colour lives in the material's
    baseColorFactor, so viewers that ignore vertex colours still show the correct colour."""
    V = np.asarray(mesh.vertices)
    n = (np.sin(1.7 * V[:, 0] + 0.3 * V[:, 1]) + np.sin(2.3 * V[:, 1] - 0.7 * V[:, 2])
         + np.sin(1.9 * V[:, 2] + 0.5 * V[:, 0])) / 3.0
    tone = (0.93 + 0.07 * n).astype(np.float32)
    return np.repeat(tone[:, None], 3, axis=1)


def fat_sleeve(path, n=None):
    """A flattened band of epicardial fat just under an artery (visible as a yellow rim around it)."""
    P = snap(path, offset=-0.24, iters=8)
    n = len(P)
    r = np.full(n, 0.5)
    a, b = max(n // 12, 2), max(n // 8, 2)
    r[:a] *= np.linspace(0.3, 1, a)
    r[n - b:] *= np.linspace(1, 0.35, b)
    return tube_mesh(P, r, nseg=16)


def finish_gltf(path, colors):
    """Post-process: named PBR materials, node extras, a single 'Heart' root node, asset info."""
    from pygltflib import GLTF2, Material, Node, PbrMetallicRoughness
    from pygltflib import Accessor, BufferView
    g = GLTF2().load(path)
    blob = bytearray(g.binary_blob())
    g.materials = []
    mat_index = {}
    for node in g.nodes:
        if node.mesh is None:
            continue
        name = node.name
        mesh = g.meshes[node.mesh]
        is_art = name in ("LAD", "LCX", "RCA")
        if is_art:
            rgb = list(map(float, srgb(ARTERY_COLORS[name])))
        elif name.startswith("Fat"):
            rgb = list(map(float, srgb(FAT)))
        else:
            rgb = list(map(float, srgb(PALETTE[name])))
        mat = Material(name=f"mat_{name}", doubleSided=False,
                       pbrMetallicRoughness=PbrMetallicRoughness(baseColorFactor=rgb + [1.0], metallicFactor=0.0,
                                                                 roughnessFactor=0.42 if is_art else (0.7 if name.startswith('Fat') else ROUGH.get(name, 0.5))))
        g.materials.append(mat)
        for prim in mesh.primitives:
            prim.material = len(g.materials) - 1
            if name in colors:                       # float COLOR_0 (8-bit would band in the dark reds)
                col = colors[name]
                assert len(col) == g.accessors[prim.attributes.POSITION].count, f"colour/vertex mismatch for {name}"
                while len(blob) % 4:
                    blob.append(0)
                g.bufferViews.append(BufferView(buffer=0, byteOffset=len(blob), byteLength=col.nbytes, target=34962))
                blob += col.astype("<f4").tobytes()
                g.accessors.append(Accessor(bufferView=len(g.bufferViews) - 1, componentType=5126, count=len(col), type="VEC3"))
                prim.attributes.COLOR_0 = len(g.accessors) - 1
        node.extras = {"part": name, "coronaryArtery": bool(is_art)} | ({"vessel": name} if is_art else {}) | ({"vessel": name[3:], "role": "fat band under the artery"} if name.startswith("Fat") else {})
    top = list(g.scenes[0].nodes)
    g.nodes.append(Node(name="Heart", children=top, extras={"units": "1 unit ~ 10 cm", "frame": "Y up, +Z anterior, +X patient left"}))
    g.scenes[0].nodes = [len(g.nodes) - 1]
    for mesh in g.meshes:                              # silence validator hints: declare vertex / index buffers
        for prim in mesh.primitives:
            for acc_i in vars(prim.attributes).values():
                if isinstance(acc_i, int) and g.accessors[acc_i].bufferView is not None:
                    g.bufferViews[g.accessors[acc_i].bufferView].target = 34962
            if prim.indices is not None:
                g.bufferViews[g.accessors[prim.indices].bufferView].target = 34963
    g.buffers[0].byteLength = len(blob)
    g.set_binary_blob(bytes(blob))
    g.asset.generator = "make_heart_glb.py (procedural, original geometry)"
    g.asset.copyright = "Procedurally generated for this project; no third-party mesh data."
    g.save(path)


if __name__ == "__main__":
    import time
    t0 = time.time()
    parts = build_body_meshes()
    arteries = {}
    for name, tubes in build_arteries().items():
        arteries[name] = merge_tubes(tubes)
    tubes_all = build_arteries()
    colors = {}
    for k in list(parts):
        parts[k] = decimate(parts[k], TARGET_FACES[k])
        colors[k] = muscle_tone(parts[k])
    parts.update(arteries)
    for k, m in parts.items():
        print(f"{k:16s} verts={len(m.vertices):6d} faces={len(m.faces):6d}")
    centre = np.array([0.0, 2.5, -0.3])
    M = world_transform(centre)
    scene = trimesh.Scene()
    order = ["Ventricles", "Atria", "Aorta", "PulmonaryTrunk", "SVC", "IVC", "PulmonaryVeins", "LAD", "LCX", "RCA"]
    for k in order:
        m = parts[k]
        m.apply_transform(M)
        scene.add_geometry(m, node_name=k, geom_name=k)
    data = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
    open(OUT, "wb").write(data)
    finish_gltf(OUT, colors)
    import os
    print("wrote", OUT, f"{os.path.getsize(OUT) / 1e6:.2f} MB  {time.time() - t0:.1f}s")
