#!/usr/bin/env python3
"""
E0/E1/E2 — Long-range acquisition offline feasibility gate

질문: **1.5m에서 스마트폰 카메라에 들어온 픽셀만으로 패널의 planar
correspondence(homography)를 복원할 정보가 충분한가?**

이 스크립트는 WebAR 코드를 전혀 쓰지 않고 정지사진 한 장으로 그것을 판정한다.
실시간 성능을 보장하지는 않지만, 통과하지 못하면 실시간 구현을 시작할 이유가 없다.

세 축을 함께 본다:
  E0  full-resolution에서 homography가 복원되는가            → 정보가 존재하는가
  E1  같은 사진을 1280/960/640/480으로 낮추며 반복           → 해상도가 병목인가
  E2  ORB / AKAZE / SIFT / BRISK 비교                        → 알고리즘 민감도

판정은 알고리즘 이름이 아니라 결과로 한다:
  keypoints / good matches / RANSAC inliers / inlier ratio /
  reprojection error / 복원된 사각형의 볼록성·형태 타당성

사용:
  python3 tools/acq_bench.py --ref <레퍼런스이미지> --query <촬영사진> [--out <결과폴더>]
  # 여러 장(1.0/1.5/2.0m)을 한 번에:
  python3 tools/acq_bench.py --ref ref.jpg --query a.jpg b.jpg c.jpg
"""

import argparse
import json
import os

import cv2
import numpy as np

# 질의 이미지를 이 긴 변 길이로 줄여가며 반복 (E1 resolution sweep)
SWEEP = [None, 1920, 1280, 960, 640, 480]

# 판정 임계 — 넉넉하지만 "우연한 매칭"은 걸러내는 수준
MIN_INLIERS = 15
MIN_INLIER_RATIO = 0.15
MAX_REPROJ_ERR = 5.0  # px (질의 이미지 기준)


def build_detectors():
    """사용 가능한 detector만 담는다. 각각 (이름, 객체, norm)."""
    out = []
    if hasattr(cv2, "ORB_create"):
        out.append(("ORB", cv2.ORB_create(nfeatures=5000), cv2.NORM_HAMMING))
    if hasattr(cv2, "AKAZE_create"):
        out.append(("AKAZE", cv2.AKAZE_create(), cv2.NORM_HAMMING))
    if hasattr(cv2, "BRISK_create"):
        out.append(("BRISK", cv2.BRISK_create(), cv2.NORM_HAMMING))
    if hasattr(cv2, "SIFT_create"):
        out.append(("SIFT", cv2.SIFT_create(nfeatures=5000), cv2.NORM_L2))
    return out


def resize_long_side(img, long_side):
    if long_side is None:
        return img
    h, w = img.shape[:2]
    cur = max(h, w)
    if cur <= long_side:
        return img
    s = long_side / cur
    return cv2.resize(img, (int(round(w * s)), int(round(h * s))), interpolation=cv2.INTER_AREA)


def quad_is_sane(quad, img_shape):
    """복원된 사각형이 실제 평면 물체로 볼 만한 형태인가.

    homography는 inlier가 있어도 뒤집히거나 찌그러진 사각형을 낼 수 있으므로,
    볼록성·면적으로 헛것을 걸러낸다.
    """
    pts = quad.reshape(-1, 2).astype(np.float32)
    if not cv2.isContourConvex(pts.astype(np.int32)):
        return False, "비볼록(찌그러짐)"
    area = abs(cv2.contourArea(pts))
    h, w = img_shape[:2]
    frac = area / float(h * w)
    if frac < 0.005:
        return False, f"면적 과소({frac:.3%})"
    if frac > 1.8:
        return False, f"면적 과대({frac:.3%})"
    return True, f"면적 {frac:.1%}"


def match_and_homography(ref_gray, qry_gray, det, norm):
    kp1, des1 = det.detectAndCompute(ref_gray, None)
    kp2, des2 = det.detectAndCompute(qry_gray, None)
    res = {
        "ref_kp": 0 if kp1 is None else len(kp1),
        "qry_kp": 0 if kp2 is None else len(kp2),
        "good": 0,
        "inliers": 0,
        "inlier_ratio": 0.0,
        "reproj_err": None,
        "quad": None,
        "note": "",
    }
    if des1 is None or des2 is None or len(kp1) < 8 or len(kp2) < 8:
        res["note"] = "특징점 부족"
        return res

    # ratio test — 애매한 대응을 먼저 버린다
    bf = cv2.BFMatcher(norm)
    knn = bf.knnMatch(des1, des2, k=2)
    good = [m for m, n in (p for p in knn if len(p) == 2) if m.distance < 0.75 * n.distance]
    res["good"] = len(good)
    if len(good) < 8:
        res["note"] = "good match 부족"
        return res

    src = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0, maxIters=5000, confidence=0.995)
    if H is None:
        res["note"] = "homography 실패"
        return res

    inl = int(mask.sum())
    res["inliers"] = inl
    res["inlier_ratio"] = inl / float(len(good))

    # inlier들만의 재투영 오차 (질의 이미지 픽셀 기준)
    proj = cv2.perspectiveTransform(src, H)
    err = np.linalg.norm((proj - dst).reshape(-1, 2), axis=1)
    err = err[mask.ravel().astype(bool)]
    res["reproj_err"] = float(np.median(err)) if len(err) else None

    h, w = ref_gray.shape[:2]
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
    res["quad"] = cv2.perspectiveTransform(corners, H)
    return res


def judge(res, qry_shape):
    if res["quad"] is None:
        return False, res["note"] or "실패"
    ok_shape, shape_note = quad_is_sane(res["quad"], qry_shape)
    if not ok_shape:
        return False, shape_note
    if res["inliers"] < MIN_INLIERS:
        return False, f"inlier {res['inliers']} < {MIN_INLIERS}"
    if res["inlier_ratio"] < MIN_INLIER_RATIO:
        return False, f"inlier비 {res['inlier_ratio']:.2f} < {MIN_INLIER_RATIO}"
    if res["reproj_err"] is not None and res["reproj_err"] > MAX_REPROJ_ERR:
        return False, f"재투영오차 {res['reproj_err']:.1f}px"
    return True, shape_note


def run(ref_path, query_paths, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    ref = cv2.imread(ref_path, cv2.IMREAD_GRAYSCALE)
    if ref is None:
        raise SystemExit(f"레퍼런스 읽기 실패: {ref_path}")
    dets = build_detectors()
    print(f"레퍼런스: {ref_path}  {ref.shape[1]}x{ref.shape[0]}")
    print(f"detector: {', '.join(n for n, _, _ in dets)}\n")

    report = []
    for qp in query_paths:
        qcolor = cv2.imread(qp, cv2.IMREAD_COLOR)
        if qcolor is None:
            print(f"[건너뜀] 읽기 실패: {qp}")
            continue
        print(f"=== 질의: {os.path.basename(qp)}  {qcolor.shape[1]}x{qcolor.shape[0]} ===")
        for long_side in SWEEP:
            q = resize_long_side(qcolor, long_side)
            qg = cv2.cvtColor(q, cv2.COLOR_BGR2GRAY)
            label = "full" if long_side is None else str(long_side)
            if long_side is not None and max(qcolor.shape[:2]) <= long_side:
                continue  # 원본보다 큰 스윕 단계는 의미 없음
            for name, det, norm in dets:
                r = match_and_homography(ref, qg, det, norm)
                ok, note = judge(r, qg.shape)
                err_s = "  -  " if r["reproj_err"] is None else f"{r['reproj_err']:5.1f}"
                print(
                    f"  {label:>5}px  {name:<6} "
                    f"kp {r['ref_kp']:>5}/{r['qry_kp']:>5}  good {r['good']:>4}  "
                    f"inlier {r['inliers']:>4} ({r['inlier_ratio']:.2f})  "
                    f"err {err_s}px  "
                    f"{'PASS' if ok else 'fail'}  {note}"
                )
                report.append(
                    {
                        "query": os.path.basename(qp),
                        "long_side": label,
                        "detector": name,
                        "ref_kp": r["ref_kp"],
                        "qry_kp": r["qry_kp"],
                        "good": r["good"],
                        "inliers": r["inliers"],
                        "inlier_ratio": round(r["inlier_ratio"], 3),
                        "reproj_err": None if r["reproj_err"] is None else round(r["reproj_err"], 2),
                        "pass": ok,
                        "note": note,
                    }
                )
                # PASS면 복원 사각형을 그려 저장 (육안 확인용)
                if ok:
                    vis = q.copy()
                    cv2.polylines(vis, [np.int32(r["quad"])], True, (0, 230, 120), 3, cv2.LINE_AA)
                    cv2.imwrite(
                        os.path.join(out_dir, f"{os.path.splitext(os.path.basename(qp))[0]}_{label}_{name}.jpg"),
                        vis,
                    )
        print()

    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"결과 저장: {out_dir}/report.json")
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True, help="레퍼런스 이미지(원본 아트워크)")
    ap.add_argument("--query", required=True, nargs="+", help="촬영 사진 1장 이상")
    ap.add_argument("--out", default="tools/acq_out", help="결과 폴더")
    a = ap.parse_args()
    run(a.ref, a.query, a.out)
