"""Original SportSnap assets. Run with Blender 5.2, not system Python.

blender -b -P tools/blender/make_sport_models.py -- --out frontend/public/models
Author: SportSnap team. No external assets, textures, or add-ons.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import traceback
from typing import Any, Callable, Sequence

import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
TAU = math.tau
Point = tuple[float, float, float]
M: dict[str, Any] = {}


def material(name: str, color: tuple[float, float, float], roughness: float = .55,
             metallic: float = 0) -> Any:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    return mat


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    colors = {
        'white': (.9, .92, .88), 'black': (.018, .025, .035),
        'red': (.75, .025, .035), 'blue': (.025, .19, .65),
        'orange': (.95, .23, .025), 'brown': (.23, .065, .022),
        'wood': (.59, .31, .12), 'teal': (.015, .48, .39),
        'yellow': (1, .65, .025), 'navy': (.02, .055, .14),
        'silver': (.52, .6, .67), 'glass': (.08, .3, .4),
    }
    M.clear()
    for name, color in colors.items():
        M[name] = material(name, color, .28 if name in ('silver', 'glass') else .6,
                           .8 if name == 'silver' else 0)


def finish(obj: Any, name: str, mat: str) -> Any:
    obj.name = name
    obj.data.materials.append(M[mat])
    return obj


def mesh(name: str, vertices: Sequence[Point], faces: Sequence[Sequence[int]], mat: str) -> Any:
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat)


def box(name: str, at: Point, size: Point, mat: str, bevel: float = 0) -> Any:
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Soft manufactured edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj, name, mat)


def ball(name: str, at: Point, radii: Point, mat: str, segments: int = 32, rings: int = 16) -> Any:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=at)
    obj = bpy.context.object
    obj.scale = radii
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat)


def rod(name: str, a: Point, b: Point, radius: float, mat: str, end_radius: float | None = None,
        vertices: int = 12) -> Any:
    av, bv = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
                                  radius2=radius if end_radius is None else end_radius,
                                  depth=(bv-av).length, location=(av+bv)/2)
    obj = bpy.context.object
    obj.rotation_euler = (bv-av).to_track_quat('Z', 'Y').to_euler()
    return finish(obj, name, mat)


def line(name: str, points: Sequence[Point], radius: float, mat: str, closed: bool = False) -> Any:
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 1
    curve.resolution_u = 1
    spline = curve.splines.new('POLY')
    spline.points.add(len(points)-1)
    for target, point in zip(spline.points, points):
        target.co = (*point, 1)
    spline.use_cyclic_u = closed
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return finish(obj, name, mat)


def ring(name: str, center: Point, radius: float, tube: float, mat: str,
         plane: str = 'XY', segments: int = 48) -> Any:
    points = []
    for i in range(segments):
        a, c = TAU*i/segments, Vector(center)
        if plane == 'XY':
            c += Vector((radius*math.cos(a), radius*math.sin(a), 0))
        elif plane == 'XZ':
            c += Vector((radius*math.cos(a), 0, radius*math.sin(a)))
        else:
            c += Vector((0, radius*math.cos(a), radius*math.sin(a)))
        points.append(tuple(c))
    return line(name, points, tube, mat, True)


def profile(name: str, points: Sequence[tuple[float, float]], width: float,
            offset_y: float, mat: str) -> Any:
    n = len(points)
    vertices = [(x, offset_y+y, z) for y in (-width/2, width/2) for x, z in points]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    return mesh(name, vertices, faces, mat)


def baseball() -> None:
    r, c = .0366, Vector((0, 0, .0366))
    ball('Leather baseball', tuple(c), (r, r, r), 'white')
    for side in (-1, 1):
        pts = []
        for i in range(97):
            t = TAU*i/96
            direction = Vector((side*.57+.16*math.cos(2*t), .82*math.cos(t), .82*math.sin(t))).normalized()
            pts.append(tuple(c+direction*(r+.0003)))
        line('Red curved seam', pts, .00045, 'red')
        for i in range(0, 96, 4):
            p = Vector(pts[i]); normal = (p-c).normalized()
            tangent = (Vector(pts[(i+1) % 96])-p).normalized()
            cross = normal.cross(tangent).normalized()
            line('Red herringbone stitch', [tuple(p-cross*.0016-tangent*.0008),
                                            tuple(p+cross*.0016+tangent*.0008)], .00045, 'red')
    rod('Wooden bat barrel', (-.4, .085, .031), (.12, .085, .031), .031, 'wood', .021)
    rod('Bat handle', (.12, .085, .031), (.43, .085, .031), .021, 'wood', .012)
    rod('Bat knob', (.43, .085, .031), (.445, .085, .031), .023, 'brown')


def basketball() -> None:
    r = .12
    ball('Orange basketball', (0, 0, r), (r, r, r), 'orange', 48, 24)
    for plane in ('XY', 'XZ', 'YZ'):
        ring('Dark inset-looking channel', (0, 0, r), r-.0005, .0017, 'black', plane, 96)
    for sign in (-1, 1):
        pts = []
        for i in range(97):
            a = TAU*i/96
            v = Vector((math.cos(a), math.sin(a), sign*.48*math.cos(2*a))).normalized()
            pts.append(tuple(Vector((0, 0, r))+v*(r+.0001)))
        line('Sweeping panel channel', pts, .0016, 'black', True)


def canoe_slamon() -> None:
    stations = [(-1.75, .018, .20), (-1.45, .23, .14), (-.8, .36, .09),
                (0, .38, .08), (.8, .36, .09), (1.45, .23, .14), (1.75, .018, .20)]
    vertices = []
    for x, w, bottom in stations:
        vertices += [(x, -w, .45), (x, -.78*w, bottom+.06), (x, 0, bottom),
                     (x, .78*w, bottom+.06), (x, w, .45)]
    faces = [(i*5+j, i*5+j+1, (i+1)*5+j+1, (i+1)*5+j)
             for i in range(6) for j in range(4)]
    hull = mesh('Open canoe hull', vertices, faces, 'teal')
    bpy.context.view_layer.objects.active = hull
    mod = hull.modifiers.new('Hull wall thickness', 'SOLIDIFY'); mod.thickness = .012
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for sign in (-1, 1):
        line('Gunwale', [(x, sign*w, .45) for x, w, _ in stations], .018, 'white')
    for x in (-.55, .55):
        box('Canoe seat', (x, 0, .34), (.22, .65, .045), 'wood', .01)
    rod('Single paddle shaft', (-.8, -.55, .48), (.65, -.55, .48), .018, 'wood')
    ball('Paddle blade', (.91, -.55, .48), (.34, .13, .018), 'yellow')
    rod('Paddle T grip', (-.8, -.65, .48), (-.8, -.45, .48), .023, 'black')


def field_hockey() -> None:
    line('Curved field hockey stick', [(0, 0, 1), (0, 0, .22), (.01, 0, .1),
         (.06, 0, .04), (.16, 0, .035), (.21, 0, .07), (.21, 0, .14)], .024, 'yellow')
    rod('Stick grip', (0, 0, .72), (0, 0, 1.01), .028, 'navy')
    ball('Hockey ball', (.32, 0, .0365), (.0365,)*3, 'white')


def boot(y: float, style: str) -> None:
    skating = style == 'ice'
    bottom = .055 if skating else .105
    points = [(-.125, bottom), (.17, bottom), (.18, bottom+.045), (.15, bottom+.085),
              (.025, bottom+.11), (.015, bottom+.26), (-.105, bottom+.27), (-.13, bottom+.20)]
    upper = profile('White skating boot' if skating else 'Racing boot', points, .095, y,
                    'white' if skating else ('red' if style == 'quad' else 'navy'))
    bpy.context.view_layer.objects.active = upper
    mod = upper.modifiers.new('Rounded boot leather', 'BEVEL')
    mod.width = .012; mod.segments = 3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    box('Sole', (.02, y, bottom), (.305, .106, .018), 'brown' if skating else 'black', .007)
    for z in (.135, .165, .195, .225):
        x = .025-(z-.11)*.067
        for sign in (-1, 1):
            line('Crossed laces on tongue', [(x+.004, y-sign*.027, bottom+z-.009),
                 (x+.004, y+sign*.027, bottom+z+.009)], .0024, 'navy' if skating else 'white')
    for x in (.05, .075, .1):
        line('Instep laces', [(x, y-.027, bottom+.113), (x, y+.027, bottom+.113)],
             .0024, 'navy' if skating else 'white')
    ball('Dark boot opening', (-.047, y, bottom+.262), (.042, .037, .004), 'brown' if skating else 'black')
    ring('Padded cuff', (-.045, y, bottom+.255), .053, .008, 'white' if skating else 'black')
    if skating:
        for x in (-.085, .10):
            box('Blade support', (x, y, .031), (.026, .032, .043), 'silver')
        profile('Curved steel figure blade', [(-.15, .012), (-.1, .002), (.12, .002),
                (.19, .025), (.18, .04), (.1, .023), (-.14, .025)], .004, y, 'silver')
        for x in (.13, .145, .16):
            box('Toe pick', (x, y, .015+(x-.13)*.5), (.006, .007, .015), 'silver')
    elif style == 'quad':
        for x in (-.085, .11):
            rod('Quad axle', (x, y-.08, .045), (x, y+.08, .045), .009, 'silver')
            for side in (-1, 1):
                wheel((x, y+side*.07, .045), .043, .035, 'yellow')
        ball('Toe stop', (.165, y, .052), (.026, .026, .026), 'black')
    else:
        box('Inline frame', (.025, y, .065), (.39, .025, .048), 'silver', .005)
        for x in (-.13, -.03, .07, .17):
            wheel((x, y, .05), .05, .025, 'teal')


def figure_skating_pairs() -> None:
    boot(-.085, 'ice'); boot(.085, 'ice')


def figure_skating_women() -> None:
    boot(0, 'ice')


def oval_ball(rugby_style: bool) -> None:
    length, radius = (.145, .095) if rugby_style else (.14, .085)
    center = Vector((0, 0, radius))
    ball('Rugby ball' if rugby_style else 'American football', tuple(center),
         (length, radius, radius), 'white' if rugby_style else 'brown', 48, 24)
    for a in (0, math.pi/2, math.pi, 3*math.pi/2):
        pts = [(length*math.cos(t), (radius+.0004)*math.sin(t)*math.cos(a),
                radius+(radius+.0004)*math.sin(t)*math.sin(a))
               for t in [math.pi*i/64 for i in range(65)]]
        line('Longitudinal panel seam', pts, .001, 'navy' if rugby_style else 'black')
    for x in (-.095, .095):
        section = radius*math.sqrt(1-(x/length)**2)
        pts = [(x, (section+.0004)*math.cos(TAU*i/64),
                radius+(section+.0004)*math.sin(TAU*i/64)) for i in range(64)]
        line('Contrasting end stripe', pts, .006 if rugby_style else .007,
             'teal' if rugby_style else 'white', True)
    if not rugby_style:
        line('Lace spine', [(x, 0, radius+radius*math.sqrt(1-(x/length)**2)+.001)
                            for x in [-.05+i*.005 for i in range(21)]], .002, 'white')
        for i in range(8):
            x = -.043+i*.012
            z = radius+radius*math.sqrt(1-(x/length)**2)
            line('White cross lace', [(x, -.012, z-.0005), (x, 0, z+.001),
                                     (x, .012, z-.0005)], .0018, 'white')


def football() -> None:
    oval_ball(False)


def wheel(at: Point, radius: float, width: float, mat: str = 'black') -> None:
    x, y, z = at
    rod('Tire', (x, y-width/2, z), (x, y+width/2, z), radius, mat, vertices=24)
    for sign in (-1, 1):
        rod('Wheel hub', (x, y+sign*(width/2+.001), z),
            (x, y+sign*(width/2+.006), z), radius*.48, 'silver', vertices=12)


def formula_1_racing() -> None:
    box('Low F1 chassis', (0, 0, .29), (3.8, .66, .32), 'red', .1)
    profile('Tapered nose', [(-2.55, .22), (-1.1, .23), (-.7, .53), (-1.6, .4)], .38, 0, 'red')
    for y in (-.47, .47):
        box('Sidepod', (.32, y, .35), (1.65, .38, .38), 'red', .09)
    ball('Open cockpit rim', (.1, 0, .56), (.48, .32, .11), 'black')
    box('Empty cockpit seat', (.26, 0, .59), (.22, .24, .16), 'navy', .04)
    line('Cockpit halo', [(-.38, 0, .62), (-.2, -.29, .88), (.42, -.29, .89),
                         (.42, .29, .89), (-.2, .29, .88), (-.38, 0, .62)], .033, 'black')
    for x in (-1.65, 1.45):
        for y in (-.82, .82):
            wheel((x, y, .34), .34, .31)
            rod('Suspension arm', (x, 0, .32), (x, y, .34), .027, 'silver')
    for x, z, width in ((-2.38, .20, 1.9), (2.05, .86, 1.15)):
        box('Front wing' if x < 0 else 'Rear wing', (x, 0, z), (.4, width, .07), 'black', .02)
        for y in (-width/2, width/2):
            box('Wing endplate', (x, y, z+.08), (.43, .045, .23), 'red', .015)
    for y in (-.35, .35):
        rod('Rear wing upright', (1.95, y, .35), (2.05, y, .84), .025, 'silver')


def golf() -> None:
    rod('Tee stem', (0, 0, 0), (0, 0, .055), .0025, 'wood', .004)
    rod('Tee cup', (0, 0, .05), (0, 0, .064), .004, 'wood', .009)
    # Radial mesh dents, not painted dots: golden-angle dimple centers.
    count, r, center_z = 180, .02135, .083
    centers = []
    for i in range(count):
        z = 1-2*(i+.5)/count
        a = i*math.pi*(3-math.sqrt(5))
        centers.append(Vector((math.sqrt(1-z*z)*math.cos(a), math.sqrt(1-z*z)*math.sin(a), z)))
    vertices: list[Point] = []
    nlon, nlat = 128, 64
    for j in range(nlat+1):
        theta = math.pi*j/nlat
        for i in range(nlon):
            phi = TAU*i/nlon
            v = Vector((math.sin(theta)*math.cos(phi), math.sin(theta)*math.sin(phi), math.cos(theta)))
            distance = math.acos(min(1, max(-1, max(v.dot(c) for c in centers))))
            dent = .00085*(1-(distance/.085)**2)**2 if distance < .085 else 0
            p = v*(r-dent)+Vector((0, 0, center_z))
            vertices.append(tuple(p))
    faces = [(j*nlon+i, j*nlon+(i+1) % nlon, (j+1)*nlon+(i+1) % nlon, (j+1)*nlon+i)
             for j in range(nlat) for i in range(nlon)]
    obj = mesh('Golf ball with recessed dimples', vertices, faces, 'white')
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def high_jump() -> None:
    box('Landing mat', (0, .8, .35), (5, 3, .7), 'blue', .12)
    for x in (-1.65, 0, 1.65):
        box('Mat top panel', (x, .8, .709), (1.61, 2.85, .026), 'teal', .04)
    for x in (-2.05, 2.05):
        box('Standard foot', (x, -.9, .04), (.6, .8, .08), 'navy', .025)
        rod('Upright standard', (x, -.9, .08), (x, -.9, 2.35), .035, 'silver')
        box('Crossbar support', (x, -.83, 1.99), (.12, .2, .035), 'black')
    rod('High jump crossbar', (-2.12, -.75, 2.03), (2.12, -.75, 2.03), .018, 'yellow')


def hockey() -> None:
    rod('Black rubber puck', (.27, 0, 0), (.27, 0, .0254), .0381, 'black', vertices=48)
    line('Ice hockey shaft and blade', [(-.23, 0, 1.58), (-.09, 0, .13),
         (.04, 0, .045), (.43, 0, .045)], .025, 'navy')
    box('Flat stick blade', (.22, 0, .045), (.44, .027, .08), 'black', .02)
    rod('Taped grip', (-.23, 0, 1.58), (-.208, 0, 1.35), .028, 'white')


def nascar_racing() -> None:
    box('Rounded stock car body', (0, 0, .56), (4.9, 1.85, .65), 'blue', .19)
    profile('Cabin silhouette', [(-1.15, .85), (-.58, 1.36), (.6, 1.38),
                                (1.25, .87)], 1.48, 0, 'blue')
    for y in (-.748, .748):
        profile('Side window', [(-1.02, .91), (-.52, 1.29), (-.04, 1.29), (-.04, .91)], .012, y, 'glass')
        profile('Rear side window', [(.04, .91), (.04, 1.29), (.55, 1.29), (1.05, .91)], .012, y, 'glass')
    # Sloping windshield and rear glass are original mesh panels.
    mesh('Windshield', [(-1.16, -.65, .89), (-1.16, .65, .89), (-.59, .65, 1.35),
                        (-.59, -.65, 1.35)], [(0, 1, 2, 3)], 'glass')
    mesh('Rear glass', [(.62, -.65, 1.36), (.62, .65, 1.36), (1.22, .65, .91),
                       (1.22, -.65, .91)], [(0, 1, 2, 3)], 'glass')
    for x in (-1.55, 1.5):
        for y in (-.94, .94):
            wheel((x, y, .36), .36, .24)
    for y in (-.6, .6):
        box('Headlight', (-2.456, y, .65), (.018, .42, .12), 'yellow', .025)
        box('Tail light', (2.456, y, .67), (.018, .4, .1), 'red', .02)
    box('Front grille', (-2.456, 0, .4), (.02, .9, .14), 'black', .03)
    box('Rear spoiler', (2.18, 0, .94), (.12, 1.7, .18), 'black', .02)
    # Number 7 uses geometric strokes; no fonts or third-party graphics.
    for y in (-.937, .937):
        line('Race number 7', [(-.35, y, .75), (.18, y, .75), (-.12, y, .33)], .045, 'white')


def olympic_wrestling() -> None:
    rod('Round wrestling mat', (0, 0, 0), (0, 0, .055), 6, 'blue', vertices=96)
    for name, inner, outer, mat in (('Orange passivity zone', 4, 4.5, 'orange'),
                                     ('Center circle marking', .475, .525, 'white')):
        vertices = [(r*math.cos(TAU*i/96), r*math.sin(TAU*i/96), .056)
                    for r in (inner, outer) for i in range(96)]
        mesh(name, vertices, [(i, i+96, (i+1) % 96+96, (i+1) % 96)
                              for i in range(96)], mat)
    for x in (-.8, .8):
        box('Starting mark', (x, 0, .061), (.04, .35, .008), 'white')


def polo() -> None:
    rod('Polo mallet shaft', (0, 0, .065), (.16, 0, 1.34), .012, 'wood', .016)
    rod('Mallet grip', (.125, 0, 1.1), (.16, 0, 1.34), .021, 'brown')
    rod('Cigar-shaped mallet head', (-.115, 0, .06), (.115, 0, .06), .032, 'wood', vertices=20)
    ball('Polo ball', (.25, 0, .042), (.042,)*3, 'white')


def rings() -> None:
    for x in (-1.15, 1.15):
        box('Frame foot', (x, 0, .055), (.22, 1.6, .11), 'navy', .03)
        rod('Frame upright', (x, 0, .11), (x, 0, 3.5), .055, 'silver')
        for y in (-.7, .7):
            rod('Diagonal brace', (x, y, .1), (x, 0, 1), .024, 'silver')
    rod('Overhead frame', (-1.2, 0, 3.5), (1.2, 0, 3.5), .065, 'silver')
    for x in (-.25, .25):
        box('Hanging strap', (x, 0, 2.91), (.035, .014, 1.1), 'navy')
        ring('Wooden gymnastic ring', (x, 0, 2.25), .105, .014, 'wood', 'XZ', 48)


def roller_derby() -> None:
    boot(0, 'quad')


def rollerblade_racing() -> None:
    boot(0, 'inline')


def rugby() -> None:
    oval_ball(True)


def swimming() -> None:
    # Open-bottom hemisphere cap, not a person's head.
    vertices = []
    for j in range(13):
        t = math.pi/2*j/12
        for i in range(48):
            a = TAU*i/48
            vertices.append((.10*math.sin(t)*math.cos(a), .12*math.sin(t)*math.sin(a),
                             .002+.12*math.cos(t)))
    faces = [(j*48+i, j*48+(i+1) % 48, (j+1)*48+(i+1) % 48, (j+1)*48+i)
             for j in range(12) for i in range(48)]
    cap = mesh('Open silicone swim cap', vertices, faces, 'blue')
    bpy.context.view_layer.objects.active = cap
    mod = cap.modifiers.new('Silicone thickness', 'SOLIDIFY'); mod.thickness = .002
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for x in (-.038, .038):
        ball('Goggle lens', (x, -.175, .022), (.032, .022, .009), 'glass')
        pts = [(x+.034*math.cos(TAU*i/48), -.175+.024*math.sin(TAU*i/48), .024) for i in range(48)]
        line('Goggle seal', pts, .005, 'black', True)
    rod('Goggle nose bridge', (-.008, -.175, .024), (.008, -.175, .024), .004, 'black')
    line('Goggle head strap', [(-.07, -.175, .02), (-.115, -.1, .018),
         (-.115, .05, .018), (0, .14, .018), (.115, .05, .018),
         (.115, -.1, .018), (.07, -.175, .02)], .004, 'navy')


def uneven_bars() -> None:
    for y, height in ((-.72, 1.7), (.72, 2.5)):
        for x in (-1.2, 1.2):
            box('Upright foot', (x, y, .04), (.5, .65, .08), 'navy', .02)
            rod('Uneven bar upright', (x, y, .08), (x, y, height), .035, 'silver')
            rod('Height adjustment sleeve', (x, y, height-.65), (x, y, height-.35), .047, 'blue')
            for side in (-1, 1):
                rod('Tension cable', (x, y, height-.1), (x+side*.5, y+side*.45, .04), .009, 'silver')
        rod('Low wooden rail' if height < 2 else 'High wooden rail',
            (-1.28, y, height), (1.28, y, height), .02, 'wood', vertices=20)
    for x in (-1.2, 1.2):
        rod('Base connecting rail', (x, -.72, .07), (x, .72, .07), .025, 'blue')


BUILDERS: dict[str, Callable[[], None]] = {
    'baseball': baseball, 'basketball': basketball, 'canoe slamon': canoe_slamon,
    'field hockey': field_hockey, 'figure skating pairs': figure_skating_pairs,
    'figure skating women': figure_skating_women, 'football': football,
    'formula 1 racing': formula_1_racing, 'golf': golf, 'high jump': high_jump,
    'hockey': hockey, 'nascar racing': nascar_racing, 'olympic wrestling': olympic_wrestling,
    'polo': polo, 'rings': rings, 'roller derby': roller_derby,
    'rollerblade racing': rollerblade_racing, 'rugby': rugby, 'swimming': swimming,
    'uneven bars': uneven_bars,
}


def slug(label: str) -> str:
    return label.lower().replace(' ', '_')


def ground_and_join(label: str) -> Any:
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = slug(label)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Actual joined vertices avoid stale bounds and oversized rotated local boxes.
    lo = Vector(tuple(min(v.co[i] for v in obj.data.vertices) for i in range(3)))
    hi = Vector(tuple(max(v.co[i] for v in obj.data.vertices) for i in range(3)))
    offset = Vector((-(lo.x+hi.x)/2, -(lo.y+hi.y)/2, -lo.z))
    for vertex in obj.data.vertices:
        vertex.co += offset
    obj.data.update()
    bpy.context.view_layer.update()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    obj['author'] = 'SportSnap team'
    obj['source'] = 'tools/blender/make_sport_models.py; original procedural geometry'
    obj['sport'] = label
    return obj


def glb_stats(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', data)
    if magic != b'glTF' or version != 2 or length != len(data):
        raise ValueError('Invalid GLB header')
    size, kind = struct.unpack_from('<I4s', data, 12)
    if kind != b'JSON':
        raise ValueError('Missing GLB JSON chunk')
    doc = json.loads(data[20:20+size])
    triangles = 0
    for item in doc['meshes']:
        for primitive in item['primitives']:
            if primitive.get('mode', 4) != 4:
                raise ValueError('Expected triangle primitives')
            accessor = primitive.get('indices', primitive['attributes']['POSITION'])
            triangles += doc['accessors'][accessor]['count']//3
    if len(data) > 2_000_000 or triangles > 30_000:
        raise ValueError(f'Asset budget exceeded: {len(data)} bytes / {triangles} triangles')
    return {'bytes': len(data), 'triangles': triangles,
            'sha256': hashlib.sha256(data).hexdigest()}


def canonicalize_triangle_order(path: Path) -> None:
    """Blender 5.2 can emit identical triangles in different parallel tessellation order.

    Sort only complete triangle index triples within each material primitive.
    Preserve vertices, normals, materials, triangle winding, and the exporter JSON.
    """
    data = bytearray(path.read_bytes())
    json_length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20+json_length])
    binary = 28+json_length
    for item in doc['meshes']:
        for primitive in item['primitives']:
            if primitive.get('mode', 4) != 4:
                raise ValueError('Canonicalization requires indexed triangles')
            accessor = doc['accessors'][primitive['indices']]
            view = doc['bufferViews'][accessor['bufferView']]
            code = {5121: 'B', 5123: 'H', 5125: 'I'}[accessor['componentType']]
            size = struct.calcsize('<'+code)
            if view.get('byteStride', size) != size or accessor['count'] % 3:
                raise ValueError('Expected tightly packed triangle indices')
            start = binary+view.get('byteOffset', 0)+accessor.get('byteOffset', 0)
            values = struct.unpack_from('<'+code*accessor['count'], data, start)
            triangles = sorted(tuple(values[i:i+3]) for i in range(0, len(values), 3))
            for i, triangle in enumerate(triangles):
                struct.pack_into('<'+code*3, data, start+i*3*size, *triangle)
    path.write_bytes(data)


def preview(obj: Any, path: Path) -> None:
    scene = bpy.context.scene
    points = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    center = (lo+hi)/2
    span = max(hi-lo)
    box('Preview ground (not exported)', (0, 0, -span*.025-.002),
        (span*200, span*200, span*.05), 'white')
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.cycles.seed = 0
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 6
    scene.world = bpy.data.worlds.new('Studio world')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.65, .72, .85, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .45
    for name, direction, energy, size in (
        ('Key', (-3, -4, 6), 420, 4), ('Fill', (4, -1, 3), 180, 3),
        ('Rim', (1, 4, 5), 350, 3),
    ):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy*span*span
        data.shape = 'DISK'; data.size = size*span
        light = bpy.data.objects.new(name, data)
        scene.collection.objects.link(light)
        light.location = center+Vector(direction)*span
        light.rotation_euler = (center-light.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data = bpy.data.cameras.new('Preview camera')
    camera = bpy.data.objects.new('Preview camera', camera_data)
    scene.collection.objects.link(camera)
    shoe = obj.get('sport') in ('figure skating pairs', 'figure skating women',
                                'roller derby', 'rollerblade racing')
    camera.location = center+Vector((1.15 if shoe else -1.15, -1.8, 1.15))*span
    camera.rotation_euler = (center-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data.type = 'ORTHO'
    # Fit projected bounds, including tall frame apparatus and wide cars.
    inverse = camera.rotation_euler.to_matrix().transposed()
    projected = [inverse @ (p-center) for p in points]
    width = max(p.x for p in projected)-min(p.x for p in projected)
    height = max(p.y for p in projected)-min(p.y for p in projected)
    camera_data.ortho_scale = max(width, height*640/520)*1.22
    camera_data.clip_start = span*.001
    camera_data.clip_end = span*300
    scene.camera = camera
    scene.render.resolution_x = 640; scene.render.resolution_y = 520
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT/'frontend/public/models')
    parser.add_argument('--only', choices=list(BUILDERS))
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    if bpy.app.version[:2] != (5, 2):
        raise RuntimeError(f'Validated with Blender 5.2; found {bpy.app.version_string}')
    labels = json.loads((ROOT/'backend/models/labels.json').read_text(encoding='utf-8-sig'))
    if set(labels) != set(BUILDERS) or len(labels) != len(BUILDERS):
        raise ValueError('Builders must match the unchanged training labels exactly')
    output = args.out.resolve(); output.mkdir(parents=True, exist_ok=True)
    previews = ROOT/'backend/debug_frames/model_previews'
    previews.mkdir(parents=True, exist_ok=True)
    manifest_path = output/'manifest.json'
    previous = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
    entries = previous.get('models', {}) if args.only else {}
    errors: dict[str, str] = {}
    for label in labels:
        if args.only and label != args.only:
            continue
        target = output/f'{slug(label)}.glb'
        temp = output/f'{slug(label)}.pending.glb'
        entries.pop(label, None)
        try:
            reset(); BUILDERS[label]()
            obj = ground_and_join(label)
            dimensions = [round(float(v), 6) for v in obj.dimensions]
            bpy.ops.export_scene.gltf(filepath=str(temp), export_format='GLB',
                                      use_selection=True, export_yup=True, export_apply=True,
                                      export_materials='EXPORT', export_extras=True,
                                      export_cameras=False, export_lights=False,
                                      export_texcoords=False)
            canonicalize_triangle_order(temp)
            stats = glb_stats(temp)
            preview(obj, previews/f'{slug(label)}.png')
            temp.replace(target)
            entries[label] = {'file': target.name, **stats,
                              'dimensions_m': [dimensions[0], dimensions[2], dimensions[1]]}
            print(f'SPORTSNAP_OK {label}: {stats}', flush=True)
        except Exception as exc:
            temp.unlink(missing_ok=True)
            errors[label] = f'{type(exc).__name__}: {exc}'
            traceback.print_exc()
            print(f'SPORTSNAP_ERROR {label}: {errors[label]}', flush=True)
    # Retain only validated files on partial rebuilds. Never advertise a stale failure.
    entries = {label: entry for label in labels if (entry := entries.get(label))
               and (output/entry['file']).is_file()}
    manifest = {'generator': 'tools/blender/make_sport_models.py',
                'blender': bpy.app.version_string, 'units': 'meters', 'up_axis': 'Y',
                'origin': 'bottom-center', 'models': entries}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    report = {'models': entries, 'errors': errors}
    (previews/'generation_report.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    # Pillow is already a backend dependency; no Blender add-on or installation needed.
    python = ROOT/'backend/.venv/Scripts/python.exe'
    if not python.is_file():
        python = ROOT/'backend/.venv/bin/python'
    if not python.is_file():
        raise RuntimeError('Backend virtualenv is required to compose the contact sheet (Pillow)')
    subprocess.run([str(python), str(Path(__file__).with_name('contact_sheet.py')),
                    '--manifest', str(manifest_path), '--previews', str(previews)], check=True)
    print(f'SPORTSNAP_REPORT {len(entries)} models; errors={errors}', flush=True)
    if errors:
        raise RuntimeError(f'Failed sports: {", ".join(errors)}; see generation_report.json')


if __name__ == '__main__':
    main()
