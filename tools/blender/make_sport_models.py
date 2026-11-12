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
DISPLAY_SPORTS = frozenset({'archery', 'baseball', 'boxing', 'field hockey', 'hockey', 'polo',
                          'rugby', 'tennis', 'volleyball', 'figure skating women',
                          'figure skating pairs', 'olympic wrestling', 'swimming'})


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


def display_base(surface: str, size: tuple[float, float] = (.35, .28),
                 circular: bool = False) -> None:
    """Tabletop diorama, meters at display scale; base thickness is 15 mm."""
    for name, color in {'grass': (.025, .23, .055), 'clay': (.40, .14, .045),
                        'ice': (.32, .69, .87), 'water': (.015, .36, .65),
                        'skin': (.65, .35, .19), 'leather': (.52, .22, .055)}.items():
        M[name] = material(name, color, .36 if name in ('ice', 'water') else .7)
    if circular:
        rod('Beveled display plinth', (0, 0, .002), (0, 0, .013), size[0]/2, surface, vertices=64)
        rod('Plinth bottom bevel', (0, 0, 0), (0, 0, .002), size[0]/2-.003,
            surface, size[0]/2, vertices=64)
        rod('Plinth top bevel', (0, 0, .013), (0, 0, .015), size[0]/2,
            surface, size[0]/2-.003, vertices=64)
    else:
        box('Beveled display plinth', (0, 0, .0075), (*size, .015), surface, .006)


def flat_polygon(name: str, points: Sequence[tuple[float, float]], z: float, mat: str) -> Any:
    return mesh(name, [(x, y, z) for x, y in points], [tuple(range(len(points)))], mat)


def arc(name: str, center: tuple[float, float], radii: tuple[float, float],
        start: float, end: float, z: float, thickness: float, mat: str) -> None:
    line(name, [(center[0]+radii[0]*math.cos(start+(end-start)*i/48),
                 center[1]+radii[1]*math.sin(start+(end-start)*i/48), z)
                for i in range(49)], thickness, mat)


def capsule(name: str, a: Point, b: Point, radius: float, mat: str) -> None:
    rod(name, a, b, radius, mat, vertices=12)
    for point in (a, b):
        ball(name+' rounded end', point, (radius,)*3, mat, 16, 8)


def dome(name: str, center: Point, radii: Point, mat: str) -> None:
    vertices = [(center[0]+radii[0]*math.sin(math.pi*j/20)*math.cos(TAU*i/32),
                 center[1]+radii[1]*math.sin(math.pi*j/20)*math.sin(TAU*i/32),
                 center[2]+radii[2]*math.cos(math.pi*j/20))
                for j in range(11) for i in range(32)]
    faces = [(j*32+i, j*32+(i+1) % 32, (j+1)*32+(i+1) % 32, (j+1)*32+i)
             for j in range(10) for i in range(32)]
    mesh(name, vertices, faces, mat)


def goal_frame(ice: bool) -> None:
    front, back, width, height = .068, .116, .13, .095
    frame = 'red' if ice else 'white'
    for x in (-width/2, width/2):
        rod('Goal front post', (x, front, .016), (x, front, height), .004, frame)
        line('Goal side frame', [(x, front, height), (x, back, height*.8),
                                 (x, back, .018), (x, front, .018)], .003, frame)
    rod('Goal crossbar', (-width/2, front, height), (width/2, front, height), .004, frame)
    for i in range(9):
        x = -width/2+width*i/8
        line('Goal back net vertical', [(x, back, .018), (x, back, height*.8),
                                        (x, front, height)], .0011, 'white')
    for i in range(1, 6):
        z = .018+(height*.8-.018)*i/5
        line('Goal back and side net', [(-width/2, front, z), (-width/2, back, z),
              (width/2, back, z), (width/2, front, z)], .0011, 'white')


def baseball() -> None:
    display_base('grass', (.255, .255))
    bpy.context.object.rotation_euler.z = math.pi/4
    flat_polygon('Infield dirt diamond', [(0, -.146), (.125, -.021), (0, .104),
                                          (-.125, -.021)], .0156, 'clay')
    line('Diamond baselines', [(0, -.13, .017), (.107, -.023, .017),
         (0, .084, .017), (-.107, -.023, .017), (0, -.13, .017)], .002, 'white')
    flat_polygon('White five-sided home plate', [(-.013, -.115), (.013, -.115),
                 (.013, -.13), (0, -.143), (-.013, -.13)], .018, 'white')
    for x, y in ((.107, -.023), (0, .084), (-.107, -.023)):
        base = box('White base bag', (x, y, .019), (.018, .018, .004), 'white', .002)
        base.rotation_euler.z = math.pi/4
    r, c = .033, Vector((.068, -.053, .05))
    ball('Leather baseball', tuple(c), (r, r, r), 'white')
    for side in (-1, 1):
        pts = []
        for i in range(97):
            t = TAU*i/96
            direction = Vector((side*.57+.16*math.cos(2*t), .82*math.cos(t), .82*math.sin(t))).normalized()
            pts.append(tuple(c+direction*(r+.0003)))
        line('Red curved seam', pts, .0011, 'red')
        for i in range(0, 96, 4):
            p = Vector(pts[i]); normal = (p-c).normalized()
            tangent = (Vector(pts[(i+1) % 96])-p).normalized()
            cross = normal.cross(tangent).normalized()
            line('Red herringbone stitch', [tuple(p-cross*.003-tangent*.001),
                                            tuple(p+cross*.003+tangent*.001)], .0008, 'red')
    rod('Wooden bat barrel', (-.108, .033, .032), (.015, .08, .032), .014, 'wood', .01)
    rod('Bat handle', (.015, .08, .032), (.066, .093, .032), .01, 'brown', .006)
    rod('Bat knob', (.066, .093, .032), (.074, .095, .032), .012, 'wood')
    ball('Glove padded palm', (-.05, -.047, .032), (.044, .037, .019), 'leather')
    ball('Glove dark catching pocket', (-.05, -.053, .047), (.029, .025, .007), 'brown')
    for i in range(4):
        x = -.083+i*.018
        capsule('Glove raised finger', (x, -.026, .039),
                (x-.007, .007+(.008 if i in (1, 2) else 0), .056), .009, 'leather')
        line('Glove finger stitch', [(x, -.021, .049), (x-.006, .002, .064)], .0011, 'wood')
    capsule('Glove thumb', (-.02, -.052, .035), (.002, -.021, .053), .011, 'leather')
    for i in range(4):
        rod('Glove web lacing', (-.025, -.01+i*.006, .057),
            (-.005, -.021+i*.006, .057), .0018, 'brown')
    box('Glove wrist cuff', (-.05, -.08, .033), (.052, .018, .025), 'leather', .005)


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
    display_base('grass')
    line('Pitch outline', [(-.16, -.12, .017), (.16, -.12, .017), (.16, .12, .017),
                           (-.16, .12, .017)], .0017, 'white', True)
    arc('Shooting D', (0, .068), (.102, .105), math.pi, TAU, .017, .0022, 'white')
    goal_frame(False)
    line('Thick hooked field hockey stick', [(-.11, .044, .025), (.033, -.083, .025),
         (.054, -.105, .025), (.077, -.108, .025), (.092, -.092, .025),
         (.086, -.073, .025)], .007, 'yellow')
    rod('Navy field hockey grip', (-.11, .044, .025), (-.068, .007, .025), .0085, 'navy')
    ball('Oversized white hockey ball', (.113, -.057, .04), (.024,)*3, 'white')


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


def display_skate(offset: tuple[float, float], angle: float) -> None:
    before = set(bpy.context.scene.objects)
    # Elliptical loft: narrow ankle, shaped instep, rounded toe, visibly open cuff.
    sections = [(.051, .01, .084, .027), (.07, .012, .083, .029),
                (.089, -.002, .063, .026), (.113, -.034, .03, .022),
                (.168, -.038, .026, .019)]
    vertices = [(cx+rx*math.cos(TAU*i/24), ry*math.sin(TAU*i/24), z)
                for z, cx, rx, ry in sections for i in range(24)]
    faces = [(j*24+i, j*24+(i+1) % 24, (j+1)*24+(i+1) % 24, (j+1)*24+i)
             for j in range(len(sections)-1) for i in range(24)]
    mesh('Slender white leather figure boot', vertices, faces, 'white')
    ball('Dark open cuff', (-.038, 0, .165), (.022, .016, .003), 'brown', 24, 12)
    line('White padded elliptical cuff', [(-.038+.026*math.cos(TAU*i/48),
         .019*math.sin(TAU*i/48), .168) for i in range(48)], .003, 'white', True)
    box('Brown leather sole', (.012, 0, .047), (.175, .058, .012), 'brown', .008)
    box('Stacked heel', (-.048, 0, .037), (.036, .045, .018), 'brown', .003)
    for x in (-.048, .065):
        box('Blade stanchion', (x, 0, .032), (.018, .017, .024), 'silver', .002)
    profile('Long curved figure blade', [(-.091, .022), (-.07, .017), (.075, .017),
            (.112, .031), (.113, .039), (.069, .029), (-.09, .031)], .0045, 0, 'silver')
    for i in range(4):
        x = .088+i*.006
        profile('Toe-pick tooth', [(x, .021+i*.002), (x+.004, .029+i*.002),
                                  (x+.006, .023+i*.002)], .006, 0, 'silver')
    def tongue_surface(y: float, z: float) -> Point:
        for lower, upper in zip(sections, sections[1:]):
            if lower[0] <= z <= upper[0]:
                t = (z-lower[0])/(upper[0]-lower[0])
                cx, rx, ry = [lower[i]*(1-t)+upper[i]*t for i in (1, 2, 3)]
                return (cx+rx*math.sqrt(max(0, 1-(y/ry)**2))+.0008, y, z)
        raise ValueError('Lace point must stay on the boot tongue')

    for z in (.084, .10, .119, .139, .158):
        for side in (-1, 1):
            line('Crossed navy laces following leather surface',
                 [tongue_surface(side*.014*(1-2*i/8), z-.005+.01*i/8)
                  for i in range(9)], .0015, 'navy')
    for side in (-1, 1):
        arc('Lace bow loop', (-.012, side*.014), (.012, .007), 0, TAU, .169, .0014, 'navy')
    bpy.context.view_layer.update()
    from mathutils import Matrix
    transform = Matrix.Translation((offset[0], offset[1], 0)) @ Matrix.Rotation(angle, 4, 'Z')
    for obj in set(bpy.context.scene.objects)-before:
        obj.matrix_world = transform @ obj.matrix_world


def skate_trail(center: tuple[float, float], start: float, end: float) -> None:
    arc('Curved blue blade tracing', center, (.119, .092), start, end, .0168, .0016, 'blue')
    arc('Ice scratch glint', center, (.124, .097), start, end, .017, .0009, 'white')


def figure_skating_pairs() -> None:
    display_base('ice', (.35, .30))
    skate_trail((-.035, -.012), math.pi*.2, math.pi*1.8)
    skate_trail((.035, .012), -math.pi*.8, math.pi*.8)
    display_skate((-.025, -.061), -.28)
    display_skate((.025, .061), .28)


def figure_skating_women() -> None:
    display_base('ice', (.33, .33), True)
    skate_trail((-.01, .005), math.pi*.2, math.pi*1.8)
    display_skate((0, -.012), -.12)


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
    display_base('ice')
    for y, color in ((-.054, 'blue'), (.007, 'red'), (.051, 'blue')):
        rod('Rink colored stripe', (-.162, y, .0165), (.162, y, .0165), .0022, color)
    arc('Rink center faceoff circle', (0, .007), (.042, .042), 0, TAU, .017, .0018, 'red')
    arc('Rink boundary', (0, 0), (.16, .122), 0, TAU, .017, .0015, 'blue')
    goal_frame(True)
    rod('Large thick black puck', (-.077, -.052, .016), (-.077, -.052, .04), .03, 'black', vertices=40)
    ring('Puck rim', (-.077, -.052, .037), .029, .0012, 'navy')
    line('Thick ice hockey shaft', [(.116, .042, .025), (.008, -.087, .025),
                                   (-.011, -.104, .025)], .006, 'navy')
    rod('White taped hockey grip', (.116, .042, .025), (.082, .001, .025), .0075, 'white')
    blade = box('Broad ice hockey blade', (-.043, -.105, .026), (.075, .015, .021), 'black', .005)
    blade.rotation_euler.z = -.1


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
    display_base('navy', (.35, .35), True)
    for name, inner, outer, mat in (('Outer blue safety zone', .145, .169, 'blue'),
                                   ('Orange passivity ring', .123, .145, 'orange'),
                                   ('Gold wrestling area', 0, .123, 'yellow'),
                                   ('Center circle', .028, .031, 'white')):
        vertices = [(r*math.cos(TAU*i/96), r*math.sin(TAU*i/96), .0158)
                    for r in (inner, outer) for i in range(96)]
        mesh(name, vertices, [(i, i+96, (i+1) % 96+96, (i+1) % 96)
                              for i in range(96)], mat)
    # Two original mannequin figures in a standing collar-and-waist wrestling tie.
    for color, hip, shoulder, head, knees, feet in (
        ('red', (-.057, -.008, .088), (-.021, -.02, .142), (-.025, -.023, .178),
         [(-.086, -.043, .055), (-.067, .043, .055)], [(-.102, -.06, .024), (-.084, .065, .024)]),
        ('blue', (.063, .012, .088), (.025, .01, .139), (.033, .017, .175),
         [(.085, -.044, .054), (.085, .054, .054)], [(.105, -.063, .024), (.106, .073, .024)]),
    ):
        capsule(color+' singlet capsule torso', hip, shoulder, .024, color)
        capsule(color+' neck', shoulder, head, .009, 'skin')
        ball(color+' mannequin head', head, (.016, .015, .019), 'skin', 24, 12)
        for knee, foot in zip(knees, feet):
            capsule(color+' singlet thigh', hip, knee, .013, color)
            capsule(color+' shin', knee, foot, .01, 'skin')
            box(color+' wrestling shoe', (foot[0], foot[1]-.006, .023), (.03, .022, .014), 'black', .005)
    for name, shoulder, elbow, hand, color in (
        ('Red collar tie', (-.021, -.038, .141), (.019, -.05, .151), (.043, -.002, .151), 'red'),
        ('Red waist grip', (-.021, .002, .137), (-.004, .048, .112), (.059, .032, .101), 'red'),
        ('Blue collar tie', (.025, -.01, .14), (.012, -.065, .147), (-.032, -.037, .155), 'blue'),
        ('Blue waist grip', (.025, .029, .136), (.002, .054, .117), (-.053, .011, .104), 'blue'),
    ):
        capsule(name+' upper arm', shoulder, elbow, .01, color)
        capsule(name+' forearm', elbow, hand, .009, 'skin')
        ball(name+' gripping hand', hand, (.011,)*3, 'skin', 16, 8)


def polo() -> None:
    display_base('grass')
    rod('Polo goal line', (-.16, .082, .017), (.16, .082, .017), .002, 'white')
    for x in (-.117, .117):
        rod('Tall white polo goal post', (x, .082, .016), (x, .082, .177), .005, 'white')
        rod('Goal post safety padding', (x, .082, .017), (x, .082, .057), .008, 'red')
        rod('High-contrast polo post tip', (x, .082, .131), (x, .082, .177), .0053, 'red')
    rod('Thick polo mallet shaft', (-.09, -.05, .037), (-.049, -.016, .24), .005, 'wood')
    rod('Leather mallet grip', (-.058, -.023, .194), (-.049, -.016, .24), .007, 'brown')
    rod('Large transverse polo hammer', (-.126, -.05, .033), (-.054, -.05, .033), .014, 'wood', vertices=24)
    ball('Large white polo ball', (.073, -.075, .041), (.025,)*3, 'white')
    dome('Polo helmet shell', (.054, .026, .03), (.047, .043, .041), 'navy')
    ball('Polo helmet visor', (.054, -.009, .03), (.052, .034, .005), 'navy')
    line('Helmet chin strap', [(.009, .024, .029), (.025, .018, .018),
         (.082, .018, .018), (.099, .024, .029)], .003, 'brown')
    rod('Helmet top button', (.054, .026, .068), (.054, .026, .075), .005, 'navy')


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
    display_base('grass')
    for x in (-.094, .094):
        rod('High-contrast H goal upright', (x, .082, .016), (x, .082, .25), .0055, 'navy')
        box('Upright blue padding', (x, .082, .047), (.021, .022, .063), 'blue', .004)
    rod('High-contrast H goal crossbar', (-.098, .082, .123), (.098, .082, .123), .0055, 'navy')
    for y in (-.11, .075):
        rod('Rugby field goal line', (-.157, y, .017), (.157, y, .017), .0022, 'white')
    c, length, radius = Vector((0, -.057, .068)), .088, .052
    ball('Oversized rugby ball', tuple(c), (length, radius, radius), 'white', 40, 20)
    for a in (0, math.pi/2, math.pi, 3*math.pi/2):
        line('Rugby panel seam', [tuple(c+Vector((length*math.cos(t),
             (radius+.0007)*math.sin(t)*math.cos(a), (radius+.0007)*math.sin(t)*math.sin(a))))
             for t in [math.pi*i/48 for i in range(49)]], .0014, 'navy')
    for x in (-.055, .055):
        section = radius*math.sqrt(1-(x/length)**2)
        ring('Rugby colored end stripe', (x, c.y, c.z), section+.0005, .004, 'teal', 'YZ', 64)


def swimming() -> None:
    display_base('water', (.36, .28))
    for y in (-.08, 0, .08):
        for i in range(28):
            x = -.163+i*.012
            rod('Red white lane float', (x, y, .021), (x+.009, y, .021),
                .0043, 'red' if i % 2 == 0 else 'white', vertices=10)
    for y in (-.04, .04):
        rod('Pool floor lane stripe', (-.154, y, .0165), (.152, y, .0165), .0028, 'navy')
        rod('Pool floor T marking', (-.133, y-.021, .0165), (-.133, y+.021, .0165), .0028, 'navy')
    for y in (.045, .095):
        box('Starting block support', (-.125, y, .043), (.012, .012, .055), 'white', .002)
    box('Starting block platform', (-.125, .07, .078), (.065, .069, .014), 'white', .004)
    box('Starting block blue anti-slip top', (-.125, .07, .086), (.056, .061, .004), 'blue', .002)
    box('Starting block number one', (-.125, .034, .07), (.005, .003, .017), 'navy')
    dome('Oversized blue silicone swimming cap', (.069, -.031, .02), (.049, .052, .042), 'blue')
    arc('Cap pale lower rim', (.069, -.031), (.049, .052), 0, TAU, .021, .002, 'white')
    for x in (.044, .091):
        ball('Oversized goggle lens', (x, -.104, .027), (.02, .014, .007), 'glass', 24, 12)
        line('Goggle black seal', [(x+.021*math.cos(TAU*i/32),
             -.104+.015*math.sin(TAU*i/32), .029) for i in range(32)], .003, 'black', True)
    rod('Goggle bridge', (.064, -.104, .029), (.071, -.104, .029), .003, 'black')
    line('Swimming goggle strap', [(.023, -.104, .025), (.013, -.066, .023),
         (.069, -.048, .023), (.124, -.066, .023), (.113, -.104, .025)], .003, 'navy')


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


def archery() -> None:
    from mathutils import Matrix
    display_base('grass')
    rod('Shooting line', (-.15, -.108, .017), (.15, -.108, .017), .0022, 'white')

    # Target boss + concentric score rings on a wooden tripod stand at back-right.
    target_pos = Vector((.052, .052, .148))
    facing = Matrix.Translation(target_pos) @ Matrix.Rotation(-.35, 4, 'Z') @ Matrix.Rotation(math.pi/2, 4, 'X')
    before = set(bpy.context.scene.objects)
    rod('Target straw boss', (0, 0, -.024), (0, 0, -.002), .084, 'wood', vertices=48)
    for idx, (radius, mat) in enumerate((
        (.078, 'white'), (.062, 'black'), (.047, 'blue'), (.031, 'red'), (.015, 'yellow'),
    )):
        z0 = -.002 + idx*.0012
        rod(f'Target ring {mat}', (0, 0, z0), (0, 0, z0+.0014), radius, mat, vertices=48)
    # Embedded arrow hitting near the bullseye (pointing forward toward shooter).
    rod('Target arrow shaft', (.008, .010, .005), (.008, .010, .105), .0022, 'silver', vertices=10)
    rod('Target arrow point', (.008, .010, -.002), (.008, .010, .006), .0038, 'black', .0008, 10)
    for angle in (0, TAU/3, 2*TAU/3):
        dx, dy = math.cos(angle)*.008, math.sin(angle)*.008
        box('Target arrow fletching', (.008+dx*.55, .010+dy*.55, .095), (.0014, .008, .02), 'red')
        bpy.context.object.rotation_euler.z = angle + math.pi/2
    bpy.context.view_layer.update()
    for obj in set(bpy.context.scene.objects) - before:
        obj.matrix_world = facing @ obj.matrix_world

    # Wooden tripod legs placed BEHIND the target face so the target rings stay unobstructed.
    apex = (.064, .084, .185)
    for foot in ((.002, .062, .016), (.128, .042, .016), (.072, .126, .016)):
        rod('Target tripod leg', foot, apex, .0055, 'wood', .0045)
    rod('Tripod crossbar', (.018, .062, .052), (.112, .048, .052), .004, 'wood')

    # Recurve bow standing upright/angled on front-left + spare ground arrow.
    bx, by = -.092, -.028
    bow_before = set(bpy.context.scene.objects)
    box('Bow riser', (0, 0, .122), (.014, .018, .068), 'navy', .003)
    box('Bow grip', (0, -.002, .114), (.016, .021, .026), 'black', .003)
    rod('Bow stabilizer', (0, -.006, .092), (0, -.068, .082), .0035, 'black', .0025)
    ball('Stabilizer weight', (0, -.072, .081), (.006,)*3, 'red', 16, 8)
    upper_limb = [(0, .003, .152), (0, -.006, .185), (0, .008, .218), (0, .036, .242)]
    lower_limb = [(0, .003, .092), (0, -.006, .059), (0, .008, .026), (0, .036, .016)]
    line('Upper bow limb', upper_limb, .0042, 'teal')
    line('Lower bow limb', lower_limb, .0042, 'teal')
    rod('Bowstring', (0, .036, .016), (0, .036, .242), .0014, 'silver', vertices=8)
    bpy.context.view_layer.update()
    bow_xf = Matrix.Translation((bx, by, 0)) @ Matrix.Rotation(.55, 4, 'Z')
    for obj in set(bpy.context.scene.objects) - bow_before:
        obj.matrix_world = bow_xf @ obj.matrix_world

    # Ground arrow along front edge.
    rod('Ground arrow shaft', (-.125, -.084, .022), (.018, -.092, .022), .0024, 'silver', vertices=10)
    rod('Ground arrow point', (.018, -.092, .022), (.031, -.093, .022), .0042, 'black', .0006, 10)
    box('Ground arrow fletching', (-.112, -.085, .024), (.022, .011, .002), 'orange')


def boxing() -> None:
    display_base('navy', (.33, .33))
    box('Boxing canvas mat', (0, 0, .022), (.298, .298, .014), 'white', .004)
    # 4 corner posts + pads + 3 tensioned ring ropes.
    corners = (
        ((-.142, -.142), 'red'), ((.142, .142), 'blue'),
        ((-.142, .142), 'white'), ((.142, -.142), 'white'),
    )
    for (cx, cy), pad_mat in corners:
        rod('Ring corner post', (cx, cy, .016), (cx, cy, .142), .007, 'silver')
        box('Corner pad', (cx*.93, cy*.93, .086), (.024, .024, .086), pad_mat, .005)
    for z, rope_mat in ((.058, 'blue'), (.092, 'white'), (.126, 'red')):
        line('Ring rope', [(-.138, -.138, z), (.138, -.138, z),
                           (.138, .138, z), (-.138, .138, z)], .0032, rope_mat, True)
    # Two oversized facing boxing gloves in the center of the ring.
    from mathutils import Matrix
    for sign, color, yaw in ((-1, 'red', .24), (1, 'blue', math.pi - .24)):
        before = set(bpy.context.scene.objects)
        fist = ball('Glove main fist', (.012, 0, .066), (.045, .035, .033), color, 32, 16)
        for p in fist.data.polygons:
            p.use_smooth = True
        capsule('Glove thumb', (-.008, -.030, .059), (.028, -.033, .073), .015, color)
        rod('Glove wrist cuff', (-.046, 0, .057), (-.018, 0, .061), .024, 'white', .027, 24)
        rod('Glove wrist strap', (-.044, 0, .057), (-.032, 0, .059), .0255, 'black', .0255, 24)
        bpy.context.view_layer.update()
        xf = Matrix.Translation((sign*.064, sign*.008, 0)) @ Matrix.Rotation(yaw, 4, 'Z')
        for obj in set(bpy.context.scene.objects) - before:
            obj.matrix_world = xf @ obj.matrix_world


def tennis() -> None:
    from mathutils import Matrix
    display_base('clay')
    # White court markings (clay court).
    line('Doubles court boundary', [(-.152, -.112, .0168), (.152, -.112, .0168),
         (.152, .112, .0168), (-.152, .112, .0168)], .002, 'white', True)
    for y in (-.086, .086):
        rod('Singles sideline', (-.152, y, .0168), (.152, y, .0168), .0018, 'white')
    for x in (-.082, .082):
        rod('Service line', (x, -.086, .0168), (x, .086, .0168), .0018, 'white')
    rod('Center service line', (-.082, 0, .0168), (.082, 0, .0168), .0018, 'white')
    # Tennis net across the center.
    for y in (-.118, .118):
        rod('Tennis net post', (0, y, .016), (0, y, .072), .0045, 'navy')
    rod('Net top headband', (0, -.118, .069), (0, .118, .069), .004, 'white')
    for z in (.026, .040, .054):
        rod('Net horizontal cord', (0, -.116, z), (0, .116, z), .0012, 'black', vertices=8)
    for i in range(-7, 8):
        y = i*.0155
        rod('Net vertical cord', (0, y, .018), (0, y, .067), .001, 'black', vertices=8)
    # Oversized tennis racket resting cleanly inside left court without touching the net.
    before = set(bpy.context.scene.objects)
    head_pts = [(.046+.056*math.cos(TAU*i/40), .044*math.sin(TAU*i/40), .023) for i in range(40)]
    line('Tennis racket head frame', head_pts, .005, 'navy', True)
    arc('Racket teal accent', (.046, 0), (.056, .044), -math.pi*.35, math.pi*.35, .023, .0055, 'teal')
    for sy in (-1, 1):
        rod('Racket throat strut', (-.038, 0, .023), (-.004, sy*.021, .023), .0038, 'navy')
    rod('Racket shaft & grip', (-.114, 0, .023), (-.036, 0, .023), .0065, 'black', .005)
    rod('Racket grip tape', (-.112, 0, .023), (-.066, 0, .023), .0072, 'white')
    for i in range(-3, 4):
        x = .046+i*.013
        span_y = .041*math.sqrt(max(0, 1-(i*.013/.053)**2))
        rod('Racket main string', (x, -span_y, .023), (x, span_y, .023), .0009, 'silver', vertices=8)
    for j in range(-3, 4):
        y = j*.0105
        span_x = .052*math.sqrt(max(0, 1-(y/.041)**2))
        rod('Racket cross string', (.046-span_x, y, .023), (.046+span_x, y, .023), .0009, 'silver', vertices=8)
    bpy.context.view_layer.update()
    racket_xf = Matrix.Translation((-.078, -.005, .001)) @ Matrix.Rotation(1.12, 4, 'Z')
    for obj in set(bpy.context.scene.objects) - before:
        obj.matrix_world = racket_xf @ obj.matrix_world
    # Two oversized optic-yellow tennis balls with curved white seam.
    for cx, cy, rz in ((.082, -.052, .038), (.105, .048, .038)):
        r = .022
        b = ball('Yellow tennis ball', (cx, cy, rz), (r, r, r), 'yellow', 32, 16)
        for p in b.data.polygons:
            p.use_smooth = True
        pts = []
        for i in range(65):
            t = TAU*i/64
            d = Vector((.55*math.cos(t), .83*math.sin(t), .45*math.cos(2*t))).normalized()
            pts.append((cx+d.x*(r+.0004), cy+d.y*(r+.0004), rz+d.z*(r+.0004)))
        line('White tennis ball seam', pts, .0014, 'white', True)


def volleyball() -> None:
    display_base('wood')
    line('Volleyball court boundary', [(-.152, -.112, .0168), (.152, -.112, .0168),
         (.152, .112, .0168), (-.152, .112, .0168)], .0022, 'white', True)
    for x in (-.052, 0, .052):
        rod('Attack or center line', (x, -.112, .0168), (x, .112, .0168), .002, 'white')
    # High volleyball net + signature red/white antennas.
    for y in (-.122, .122):
        rod('Volleyball net post', (0, y, .016), (0, y, .178), .0055, 'blue')
        rod('Net post pad', (0, y, .018), (0, y, .105), .0095, 'navy')
    for z in (.098, .165):
        rod('Volleyball net tape', (0, -.12, z), (0, .12, z), .0038, 'white')
    for z in (.115, .132, .149):
        rod('Volleyball net cord', (0, -.118, z), (0, .118, z), .0012, 'black', vertices=8)
    for i in range(-7, 8):
        y = i*.0155
        rod('Volleyball net vertical', (0, y, .099), (0, y, .164), .001, 'black', vertices=8)
    for y in (-.108, .108):
        for idx in range(6):
            z0 = .102 + idx*.016
            rod('Volleyball antenna segment', (0, y, z0), (0, y, z0+.015),
                .0028, 'red' if idx % 2 == 0 else 'white', vertices=10)
    # Oversized tri-color (white / blue / yellow) volleyball placed clearly in front-left court.
    c = Vector((-.078, -.045, .061))
    r = .045
    nlon, nlat = 36, 18
    def sphere_patch(patch_name: str, mat: str, j_range: range, i_range: range) -> None:
        verts: list[Point] = []
        faces: list[tuple[int, int, int, int]] = []
        vmap: dict[tuple[int, int], int] = {}
        for j in range(j_range.start, j_range.stop + 1):
            theta = math.pi * j / nlat
            for i in range(i_range.start, i_range.stop + 1):
                phi = TAU * (i % nlon) / nlon
                p = Vector((math.sin(theta)*math.cos(phi), math.sin(theta)*math.sin(phi), math.cos(theta))) * r + c
                vmap[(j, i)] = len(verts)
                verts.append(tuple(p))
        for j in j_range:
            for i in i_range:
                faces.append((vmap[(j, i)], vmap[(j+1, i)], vmap[(j+1, i+1)], vmap[(j, i+1)]))
        patch = mesh(patch_name, verts, faces, mat)
        for poly in patch.data.polygons:
            poly.use_smooth = True

    sphere_patch('Volleyball top blue cap', 'blue', range(0, 6), range(0, nlon))
    sphere_patch('Volleyball bottom blue cap', 'blue', range(12, nlat), range(0, nlon))
    for sector in range(6):
        sphere_patch(
            f'Volleyball band {sector}',
            'yellow' if sector % 2 == 0 else 'white',
            range(6, 12),
            range(sector * 6, (sector + 1) * 6),
        )
    for lat in (-math.pi/6, math.pi/6):
        ring_r = r*math.cos(lat)+.0005
        ring_z = c.z+r*math.sin(lat)
        ring('Volleyball latitude seam', (c.x, c.y, ring_z), ring_r, .0013, 'navy', 'XY', 64)
    for k in range(3):
        axis_a = k * math.pi / 3
        pts = [(c.x+(r+.0006)*math.cos(t)*math.cos(axis_a),
                c.y+(r+.0006)*math.cos(t)*math.sin(axis_a),
                c.z+(r+.0006)*math.sin(t)) for t in [TAU*i/64 for i in range(65)]]
        line('Volleyball panel seam', pts, .0013, 'navy', True)


BUILDERS: dict[str, Callable[[], None]] = {
    'archery': archery, 'baseball': baseball, 'basketball': basketball, 'boxing': boxing,
    'canoe slamon': canoe_slamon, 'field hockey': field_hockey,
    'figure skating pairs': figure_skating_pairs,
    'figure skating women': figure_skating_women, 'football': football,
    'formula 1 racing': formula_1_racing, 'golf': golf, 'high jump': high_jump,
    'hockey': hockey, 'nascar racing': nascar_racing, 'olympic wrestling': olympic_wrestling,
    'polo': polo, 'rings': rings, 'roller derby': roller_derby,
    'rollerblade racing': rollerblade_racing, 'rugby': rugby, 'swimming': swimming,
    'tennis': tennis, 'uneven bars': uneven_bars, 'volleyball': volleyball,
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
    if label in DISPLAY_SPORTS:
        obj['scale_convention'] = 'display scale, not real-world size'
        obj['base_thickness_m'] = .015
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
    # Use the actual silhouette, not the empty corners around round/diamond plinths.
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
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
    if not set(labels).issubset(BUILDERS):
        raise ValueError('Builders must cover all unchanged training labels')
    all_sports = [*labels, *(name for name in sorted(BUILDERS) if name not in labels)]
    output = args.out.resolve(); output.mkdir(parents=True, exist_ok=True)
    previews = ROOT/'backend/debug_frames/model_previews'
    previews.mkdir(parents=True, exist_ok=True)
    manifest_path = output/'manifest.json'
    previous = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
    entries = previous.get('models', {}) if args.only else {}
    errors: dict[str, str] = {}
    for label in all_sports:
        if args.only and label != args.only:
            continue
        target = output/f'{slug(label)}.glb'
        temp = output/f'{slug(label)}.pending.glb'
        entries.pop(label, None)
        try:
            reset(); BUILDERS[label]()
            obj = ground_and_join(label)
            dimensions = [round(float(v), 6) for v in obj.dimensions]
            if label in DISPLAY_SPORTS and not .25 <= max(dimensions) <= .40:
                raise ValueError(f'Display extent must be 0.25-0.40 m: {dimensions}')
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
            if label in DISPLAY_SPORTS:
                entries[label]['scale'] = 'display'
            print(f'SPORTSNAP_OK {label}: {stats}', flush=True)
        except Exception as exc:
            temp.unlink(missing_ok=True)
            errors[label] = f'{type(exc).__name__}: {exc}'
            traceback.print_exc()
            print(f'SPORTSNAP_ERROR {label}: {errors[label]}', flush=True)
    # Retain only validated files on partial rebuilds. Never advertise a stale failure.
    entries = {label: entry for label in all_sports if (entry := entries.get(label))
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
