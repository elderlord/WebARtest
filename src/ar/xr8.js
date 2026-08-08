import * as THREE from 'three'
import { createAlignmentBox } from './alignmentBox.js'
import { Metrics, FpsMeter } from './metrics.js'
import { createShaderSmokeTest } from './shaderSmokeTest.js'
import { showBanner } from '../hud.js'
import { createWordProbes } from './wordProbes.js'
import { RUNTIME } from './runtime.js'

// 8th Wall XR8 카메라 파이프라인 위에 three.js 씬을 얹고,
// 이미지 타겟 인식 시 정합 박스를 타겟에 부착한다. (0단계 계측 하네스)
//
// 전제:
//   - window.XR8 런타임이 로드되어 있어야 한다 (CDN 또는 self-host, public/xr8 참고)
//   - 이미지 타겟은 image-target-cli로 컴파일해 public/targets/에 배치하고
//     manifest.json에 이름을 등록하면 런타임에 자동 로드된다.
//
// 참고 API (0-A 실측 + image-target-cli README 확인):
//   XR8.XrController.configure({ imageTargetData: [<컴파일된 target json>] })
//   reality.imagefound/imageupdated/imagelost, XR8.Threejs.pipelineModule()/xrScene()

// 타겟 매니페스트: 빌드에 타겟이 없어도 앱이 동작해야 하므로 런타임에 fetch한다.
// public/targets/manifest.json 예: { "targets": ["poster"] }
// 각 타겟은 public/targets/<name>.json (+ <name>_luminance.png)로 배치한다.
const TARGETS_DIR = 'targets'

// 진단 출력용 짧은 수치 포맷
const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) < 100 ? v.toFixed(3) : v.toFixed(1)) : '?')

// 컴파일된 타겟들을 로드한다. 없으면 빈 배열(0-A 모드: 카메라만).
export async function loadImageTargets(base = import.meta.env.BASE_URL || '/') {
  const dir = `${base}${TARGETS_DIR}`
  try {
    const res = await fetch(`${dir}/manifest.json`, { cache: 'no-cache' })
    if (!res.ok) return []
    const { targets = [] } = await res.json()
    const loaded = await Promise.all(
      targets.map(async (entry) => {
        // 매니페스트 항목은 문자열 또는 { name, widthMm } 객체를 허용한다.
        // widthMm(실물 가로 폭)이 있으면 world scale calibration(스펙 §6.2)에 쓴다.
        const name = typeof entry === 'string' ? entry : entry.name
        const widthMm = typeof entry === 'object' ? entry.widthMm : undefined
        const r = await fetch(`${dir}/${name}.json`, { cache: 'no-cache' })
        if (!r.ok) throw new Error(`타겟 로드 실패: ${name}`)
        const data = await r.json()
        if (widthMm) data.widthMm = widthMm
        // imagePath는 CLI 기본값이 'image-targets/..'이므로 실제 서빙 경로로 교정한다.
        const file = String(data.imagePath || '').split('/').pop()
        data.imagePath = `${dir}/${file}`
        if (!data.name) data.name = name
        // 0-D 단어 probe 좌표(선택): <name>_words.json 이 있으면 함께 싣는다.
        try {
          const wr = await fetch(`${dir}/${name}_words.json`, { cache: 'no-cache' })
          if (wr.ok) data.words = (await wr.json()).words || []
        } catch {}
        return data
      })
    )
    return loaded
  } catch (e) {
    console.warn('[webar] 이미지 타겟 없음/로드 실패 → 카메라만 실행:', e)
    return []
  }
}

// opts.shaderSmokeTest: true면 0-A 셰이더 스모크 테스트 모듈을 파이프라인에 추가한다.
//   (?smoke 쿼리로 켜는 것을 권장 — 아래 startXr8 호출부에서 판단)
export function startXr8({ canvas, hud, shaderSmokeTest = false, imageTargets = [] } = {}) {
  const XR8 = window.XR8
  // 인식 대상 이름 집합 (여러 패널 확장 대비). 비어 있으면 카메라만(0-A 모드).
  const targetNames = new Set(imageTargets.map((t) => t.name).filter(Boolean))
  // 타겟별 실물 폭(mm) — 엔진 단위를 미터로 환산하는 데 쓴다(스펙 §6.2)
  const widthMmByName = new Map(imageTargets.filter((t) => t.widthMm).map((t) => [t.name, t.widthMm]))
  // 엔진 1단위 = 몇 m 인가. imagefound에서 scaledWidth와 실물 폭을 비교해 정한다.
  let metersPerUnit = null
  let rawInfo = 'raw –'
  // 0-B 측정 누적값: 인식 성공 최대 거리(peak hold), 재획득 횟수
  let maxDistCm = 0
  let reacquireCount = 0
  let everFound = false
  // 획득 거리: imagefound 시점의 거리. 유지 거리와 구분해서 재야 한다
  // (실측: 가까이서 획득 후 물러나면 훨씬 멀리까지 유지됨 → 서비스상 중요한 값은 획득 거리)
  let bestAcquireCm = 0
  const box = createAlignmentBox()
  // 0-D 단어 정합 probe (타겟에 <name>_words.json 이 있을 때만)
  const wordsByName = new Map(imageTargets.filter((t) => t.words?.length).map((t) => [t.name, t.words]))
  let probes = null
  const metrics = new Metrics(30)
  const fps = new FpsMeter()

  // 타겟이 마지막으로 보고한 실측 크기 (imagefound/updated에서 갱신)
  let lastWidth = 1
  let lastHeight = 1

  const attachBox = (detail) => {
    const { position, rotation, scale, scaledWidth, scaledHeight, name } = detail
    // 엔진 원시값을 화면에 노출한다. disableWorldTracking 모드에서는 좌표가
    // 미터가 아닐 수 있어(0-B 실측), 규약을 눈으로 확인한 뒤 환산한다.
    const wMm = widthMmByName.get(name)
    const sForCal = typeof scale === 'number' && scale > 0 ? scale : 1
    if (wMm && scaledWidth) metersPerUnit = wMm / 1000 / (scaledWidth * sForCal)
    rawInfo =
      `raw sw=${fmt(scaledWidth)} sh=${fmt(scaledHeight)} scale=${fmt(scale)}` +

      (metersPerUnit ? ` · 1u=${(metersPerUnit * 100).toFixed(1)}cm` : '')
    box.position.copy(position)
    box.quaternion.copy(rotation)
    // 스케일 규약 — 0-B 실측으로 확정(k=1.000에서 인쇄 테두리와 일치):
    //   실제 타겟 크기 = scaledWidth·scale × scaledHeight·scale
    // scaledWidth/Height는 높이=1로 정규화된 치수이고 scale이 실제 배율이다.
    // (스펙 §6.3의 "scale 제외" 서술을 실측으로 정정)
    if (scaledWidth && scaledHeight) {
      const s = typeof scale === 'number' && scale > 0 ? scale : 1
      lastWidth = scaledWidth * s
      lastHeight = scaledHeight * s
      box.resize(lastWidth, lastHeight)
      // 단어 probe를 현재 타겟 크기에 맞춰 배치
      const list = wordsByName.get(name)
      if (list && !probes) {
        probes = createWordProbes(list)
        box.add(probes)
      }
      if (probes) probes.layout(lastWidth, lastHeight)
    }
    box.visible = true
  }

  const imageTargetModule = () => ({
    name: 'panel-alignment',
    onStart: () => {
      const { scene } = XR8.Threejs.xrScene()
      scene.add(box)
    },
    // 매 프레임: 계측값 갱신
    onUpdate: () => {
      const now = performance.now()
      hud.setFps(fps.tick(now))
      if (box.visible) {
        const { camera } = XR8.Threejs.xrScene()
        const m = metrics.update(box.position, box.quaternion, camera)
        // metrics는 "1단위=1m"를 가정한다. calibration이 잡히면 실제 배율로 보정.
        if (metersPerUnit) {
          m.distanceCm *= metersPerUnit
          m.poseVarMm *= metersPerUnit
        }
        // 인식에 성공한 상태에서의 최대 거리를 계속 갱신한다
        // (= 이 거리까지는 인식이 유지된다는 실측 기록)
        if (m.distanceCm > maxDistCm) {
          maxDistCm = m.distanceCm
          hud.setMaxDistance(maxDistCm)
        }
        hud.setMetrics(m)
        hud.setDebug(rawInfo)
      }
    },
    listeners: [
      {
        event: 'reality.imagefound',
        process: ({ detail }) => {
          if (!targetNames.has(detail.name)) return
          if (everFound) hud.setReacquire(++reacquireCount)
          everFound = true
          metrics.reset()
          attachBox(detail)
          hud.setFound(true)
          // 이 시점의 거리 = 초기 획득 거리
          try {
            const { camera } = XR8.Threejs.xrScene()
            let cm = box.position.distanceTo(camera.position) * 100
            if (metersPerUnit) cm *= metersPerUnit
            if (cm > bestAcquireCm) bestAcquireCm = cm
            hud.setAcquire(cm, bestAcquireCm)
          } catch {}
        },
      },
      {
        event: 'reality.imageupdated',
        process: ({ detail }) => {
          if (!targetNames.has(detail.name)) return
          attachBox(detail)
        },
      },
      {
        event: 'reality.imagelost',
        process: ({ detail }) => {
          if (!targetNames.has(detail.name)) return
          box.visible = false
          metrics.reset()
          hud.setFound(false)
        },
      },
    ],
  })

  // XR8.Threejs 파이프라인 모듈은 전역 window.THREE를 요구한다(0-A 실측 확인).
  // 우리는 three를 ES 모듈로 번들하므로 전역에 노출해 준다.
  if (!window.THREE) window.THREE = THREE

  // 이 빌드에서 파이프라인 모듈이 다른 이름일 수 있다. 없으면 어느 것이 없는지 명확히 보고.
  const need = ['GlTextureRenderer', 'Threejs', 'XrController']
  const missing = need.filter((k) => !XR8[k] || typeof XR8[k].pipelineModule !== 'function')
  if (missing.length) {
    throw new Error(`XR8 모듈 없음: ${missing.join(', ')} · 사용가능 키: ${Object.keys(XR8).join(',')}`)
  }

  const modules = [
    XR8.GlTextureRenderer.pipelineModule(), // 카메라 피드를 캔버스에 렌더
    XR8.Threejs.pipelineModule(), // three.js 씬 관리
    XR8.XrController.pipelineModule(), // 트래킹 (SLAM은 조건부: runtime.enableWorldTracking)
  ]

  // 이미지 타겟은 컴파일된 타겟이 실제로 로드됐을 때만 등록한다.
  // 타겟이 없으면(0-A) 카메라+HUD만 띄운다.
  const hasRealTarget = targetNames.size > 0
  if (hasRealTarget) modules.push(imageTargetModule())

  // 0-A 셰이더 스모크 테스트 (?smoke): 카메라 텍스처 셰이더 접근 판정
  if (shaderSmokeTest) {
    modules.push(
      createShaderSmokeTest({
        onResult: ({ pass, note }) =>
          showBanner(`<b>셰이더 스모크: ${pass ? 'PASS' : 'FAIL'}</b><br>${note}`),
      })
    )
  }

  XR8.addCameraPipelineModules(modules)

  // 0-B는 이미지 타겟 단독(disableWorldTracking: true). SLAM은 0-B2에서
  // runtime.enableWorldTracking()으로만 켠다.
  XR8.XrController.configure({ disableWorldTracking: RUNTIME.disableWorldTracking })

  if (hasRealTarget) {
    // image-target-cli 산출 JSON을 그대로 주입한다 (README 확인).
    XR8.XrController.configure({ imageTargetData: imageTargets })
    showBanner(
      `<b>0-B/0-D 실측</b> — <span style="color:#60a5fa">파랑</span>=단어 probe.<br>` +
        `<b>획득거리</b>=처음 잡히는 거리(뒤에서 다가오며), <b>유지최대</b>=잡힌 뒤 버티는 거리.`
    )
  } else {
    // 타겟 없이 카메라만: HUD에 0-A 상태 표시
    hud.setFound(false)
    showBanner(
      `<b>0-A 런타임 OK</b> — XR8 로드·카메라 기동. 타겟 미등록(사진 대기).<br>` +
        `<code>?smoke</code>로 셰이더 접근 판정.`
    )
  }

  // 캔버스 드로잉 버퍼를 뷰포트에 맞춘다.
  // XRExtras.FullWindowCanvas를 쓰지 않으므로 직접 처리해야 한다. 이걸 안 하면
  // 버퍼가 기본 300x150이라 카메라 피드가 화면 일부에만 그려진다(0-A 실측 확인).
  const fitCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(window.innerWidth * dpr)
    const h = Math.round(window.innerHeight * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    // three 렌더러가 이미 있으면 함께 갱신
    const scene = XR8.Threejs.xrScene && XR8.Threejs.xrScene()
    if (scene && scene.renderer) {
      scene.renderer.setSize(window.innerWidth, window.innerHeight, false)
    }
  }
  fitCanvas()
  window.addEventListener('resize', fitCanvas)
  window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 200))

  XR8.run({ canvas })
}
