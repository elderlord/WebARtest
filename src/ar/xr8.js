import * as THREE from 'three'
import { createAlignmentBox } from './alignmentBox.js'
import { Metrics, FpsMeter } from './metrics.js'
import { createShaderSmokeTest } from './shaderSmokeTest.js'
import { showBanner } from '../hud.js'
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
  // 스케일 규약 판정용 두 후보를 동시에 그린다(0-B 실측).
  //   초록  A안: 크기 = scaledWidth × scaledHeight        (scale 미적용)
  //   자홍  B안: 크기 = scaledWidth·scale × scaledHeight·scale
  // 인쇄 테두리에 겹치는 쪽이 올바른 규약 → 확정 후 나머지는 제거한다.
  const box = createAlignmentBox()
  const boxB = createAlignmentBox({ color: 0xff4dd2, cornerColor: 0xff4dd2, withAxes: false })
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
    if (wMm && scaledWidth) metersPerUnit = wMm / 1000 / scaledWidth
    rawInfo =
      `raw sw=${fmt(scaledWidth)} sh=${fmt(scaledHeight)} scale=${fmt(scale)}` +
      ` pos=(${fmt(position?.x)},${fmt(position?.y)},${fmt(position?.z)})` +
      (metersPerUnit ? ` · 1u=${(metersPerUnit * 100).toFixed(1)}cm` : '')
    box.position.copy(position)
    box.quaternion.copy(rotation)
    // 주의(스펙 §6.3): detail에는 scale과 scaledWidth/Height가 함께 온다.
    // scaledWidth/Height가 이미 scale이 반영된 실측 크기이므로, box.scale까지
    // 따로 걸면 이중 적용이 된다. 여기서는 크기의 단일 출처로 scaledWidth/Height만
    // 쓴다(geometry를 실측 크기로 resize). 실 런타임 연결 시 줄자로 검증해
    // 규약이 다르면 이 지점만 조정한다.
    if (scaledWidth && scaledHeight) {
      lastWidth = scaledWidth
      lastHeight = scaledHeight
      box.resize(scaledWidth, scaledHeight)
      const s = typeof scale === 'number' && scale > 0 ? scale : 1
      boxB.resize(scaledWidth * s, scaledHeight * s)
    }
    boxB.position.copy(position)
    boxB.quaternion.copy(rotation)
    box.visible = true
    boxB.visible = true
  }

  const imageTargetModule = () => ({
    name: 'panel-alignment',
    onStart: () => {
      const { scene } = XR8.Threejs.xrScene()
      scene.add(box)
      scene.add(boxB)
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
        hud.setMetrics(m)
        hud.setDebug(rawInfo)
      }
    },
    listeners: [
      {
        event: 'reality.imagefound',
        process: ({ detail }) => {
          if (!targetNames.has(detail.name)) return
          metrics.reset()
          attachBox(detail)
          hud.setFound(true)
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
          boxB.visible = false
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
      `<b>0-B 스케일 판정</b> — ${[...targetNames].join(', ')}<br>` +
        `<span style="color:#34d399">초록</span>=scale 미적용 / ` +
        `<span style="color:#ff4dd2">자홍</span>=scale 적용.<br>` +
        `인쇄 테두리에 <b>겹치는 쪽</b>을 알려주세요.`
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
