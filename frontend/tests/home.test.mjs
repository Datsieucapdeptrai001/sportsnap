import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { FALLBACK_MODEL_SRC, TROPHY_MODEL_SRC, nextFallbackSrc, pickSportModel } from '../src/lib/sport-models.ts'
import { SAMPLE_PHOTOS, isAcceptedImage } from '../src/lib/samples.ts'

const assets = { golf: { glb: '/models/golf.glb' }, broken: { glb: '../evil.glb' } }

test('certain mapped result uses its own model and allows AR', () => {
  assert.deepEqual(pickSportModel({ label: 'golf', is_uncertain: false }, assets),
    { src: '/models/golf.glb', isFallback: false, arAllowed: true, reason: 'mapped' })
})

test('any result shows its top-1 sport model with AR, whatever the confidence', () => {
  assert.deepEqual(pickSportModel({ label: 'golf', is_uncertain: true }, assets),
    { src: '/models/golf.glb', isFallback: false, arAllowed: true, reason: 'mapped' })
  assert.equal(pickSportModel({ label: 'curling', is_uncertain: false }, assets).src, '/models/curling.glb')
  assert.equal(pickSportModel({ label: 'broken', is_uncertain: false }, assets).src, '/models/broken.glb')
  assert.equal(pickSportModel({ label: 'toString', is_uncertain: false }, assets).src, '/models/tostring.glb')
  const idle = pickSportModel(null, assets)
  assert.equal(idle.src, TROPHY_MODEL_SRC)
  assert.equal(idle.arAllowed, false)
})

test('load failures fall back sport -> trophy -> podium -> stop', () => {
  assert.equal(nextFallbackSrc('/models/golf.glb'), TROPHY_MODEL_SRC)
  assert.equal(nextFallbackSrc('/models/golf.glb?ar-retry=2'), TROPHY_MODEL_SRC)
  assert.equal(nextFallbackSrc(TROPHY_MODEL_SRC), FALLBACK_MODEL_SRC)
  assert.equal(nextFallbackSrc(FALLBACK_MODEL_SRC), null)
})

test('fallback GLB and sample photos are committed files', () => {
  const glb = readFileSync(new URL(`../public${FALLBACK_MODEL_SRC}`, import.meta.url))
  assert.equal(glb.toString('ascii', 0, 4), 'glTF')
  assert.equal(glb.readUInt32LE(8), glb.length)
  assert.ok(SAMPLE_PHOTOS.length >= 3 && SAMPLE_PHOTOS.length <= 4)
  for (const sample of SAMPLE_PHOTOS) assert.ok(existsSync(new URL(`../public${sample.src}`, import.meta.url)), sample.src)
})

test('client-side type check accepts only JPG, PNG and WebP', () => {
  assert.ok(isAcceptedImage({ type: 'image/jpeg', name: 'a.jpg' }))
  assert.ok(isAcceptedImage({ type: 'image/webp', name: 'a' }))
  assert.ok(isAcceptedImage({ type: '', name: 'photo.PNG' }))
  assert.ok(!isAcceptedImage({ type: 'image/heic', name: 'a.heic' }))
  assert.ok(!isAcceptedImage({ type: 'application/pdf', name: 'a.pdf' }))
})

test('explicit 3D mapping covers all 20 training labels and matches the manifest files', async () => {
  const { SPORT_MODEL_FILES } = await import('../src/lib/sport-models.ts')
  const labels = JSON.parse(readFileSync(new URL('../../backend/models/labels.json', import.meta.url), 'utf8').replace(/^﻿/, ''))
  const manifest = JSON.parse(readFileSync(new URL('../public/models/manifest.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(SPORT_MODEL_FILES).sort(), [...labels].sort())
  for (const label of labels) {
    assert.equal(SPORT_MODEL_FILES[label], `/models/${manifest.models[label].file}`)
    assert.ok(existsSync(new URL(`../public${SPORT_MODEL_FILES[label]}`, import.meta.url)), label)
  }
})
