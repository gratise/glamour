from __future__ import annotations

import heapq
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from skimage.morphology import skeletonize


@dataclass(frozen=True)
class ExtractionConfig:
    mode: str
    threshold: float = 36.0
    max_error: float = 1.5
    color: str | None = None


def _parse_color(value: str | None) -> tuple[int, int, int] | None:
    if not value:
        return None
    normalized = value.removeprefix("#")
    if len(normalized) != 6:
        raise ValueError("Color must be a six-digit hex value such as #3a7bff.")
    return tuple(int(normalized[offset : offset + 2], 16) for offset in (0, 2, 4))


def _load_crop(payload: dict[str, Any]) -> tuple[np.ndarray, tuple[float, float, float, float]]:
    source = Path(payload["sourcePath"])
    image = cv2.imread(str(source), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Could not decode reference screenshot: {source}")
    dpr = float(payload.get("deviceScaleFactor", 1))
    x, y, width, height = (float(value) for value in payload["bbox"])
    left = max(0, int(math.floor(x * dpr)))
    top = max(0, int(math.floor(y * dpr)))
    right = min(image.shape[1], int(math.ceil((x + width) * dpr)))
    bottom = min(image.shape[0], int(math.ceil((y + height) * dpr)))
    crop = image[top:bottom, left:right]
    if crop.size == 0:
        raise ValueError("The requested geometry region is outside the reference image.")
    return crop, (x, y, width, height)


def _foreground_mask(
    crop_bgr: np.ndarray, config: ExtractionConfig
) -> tuple[np.ndarray, tuple[int, int, int]]:
    rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    border = np.concatenate((rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]), axis=0)
    background = np.median(border, axis=0)
    foreground_color = _parse_color(config.color)
    if foreground_color:
        distance = np.linalg.norm(rgb - np.array(foreground_color, dtype=np.float32), axis=2)
        mask = distance < max(config.threshold, 12)
        estimated = foreground_color
    else:
        distance = np.linalg.norm(rgb - background[None, None, :], axis=2)
        mask = distance > config.threshold
        ys, xs = np.where(mask)
        if len(xs):
            pixels = rgb[ys, xs]
            median = np.median(pixels, axis=0)
            dark_or_saturated = pixels[
                np.linalg.norm(pixels - median, axis=1) < max(config.threshold, 20)
            ]
            estimated = (
                tuple(int(value) for value in np.median(dark_or_saturated, axis=0))
                if len(dark_or_saturated)
                else tuple(int(value) for value in median)
            )
        else:
            estimated = (0, 0, 0)
    mask_u8 = mask.astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_CLOSE, kernel)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask_u8, 8)
    cleaned = np.zeros_like(mask_u8)
    min_area = max(2, int(mask_u8.size * 0.00002))
    for component in range(1, count):
        if stats[component, cv2.CC_STAT_AREA] >= min_area:
            cleaned[labels == component] = 255
    return cleaned, estimated


def _ordered_skeleton(mask: np.ndarray) -> np.ndarray:
    thin = skeletonize(mask > 0)
    ys, xs = np.where(thin)
    points = np.column_stack((xs, ys)).astype(np.float32)
    if len(points) < 2:
        return points
    index_by_point = {(int(x), int(y)): i for i, (x, y) in enumerate(points)}
    adjacency: list[list[int]] = [[] for _ in points]
    for i, (x, y) in enumerate(points):
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                neighbor = index_by_point.get((int(x + dx), int(y + dy)))
                if neighbor is not None:
                    adjacency[i].append(neighbor)
    endpoints = [i for i, edges in enumerate(adjacency) if len(edges) == 1]

    def shortest_paths(start: int) -> tuple[np.ndarray, list[int]]:
        distances = np.full(len(points), np.inf, dtype=np.float64)
        previous = [-1] * len(points)
        distances[start] = 0.0
        queue = [(0.0, start)]
        while queue:
            distance, current = heapq.heappop(queue)
            if distance != distances[current]:
                continue
            for neighbor in adjacency[current]:
                edge = float(np.linalg.norm(points[neighbor] - points[current]))
                candidate = distance + edge
                if candidate < distances[neighbor]:
                    distances[neighbor] = candidate
                    previous[neighbor] = current
                    heapq.heappush(queue, (candidate, neighbor))
        return distances, previous

    first = endpoints[0] if endpoints else int(np.argmin(points[:, 0] + points[:, 1]))
    distances, _ = shortest_paths(first)
    start = max(endpoints, key=lambda index: distances[index]) if endpoints else first
    distances, previous = shortest_paths(start)
    end = (
        max(endpoints, key=lambda index: distances[index])
        if endpoints
        else int(np.argmax(distances))
    )
    ordered = [end]
    while ordered[-1] != start and previous[ordered[-1]] >= 0:
        ordered.append(previous[ordered[-1]])
    ordered.reverse()
    return points[ordered]


def _simplify(points: np.ndarray, max_error: float) -> np.ndarray:
    if len(points) < 3:
        return points
    contour = points.reshape((-1, 1, 2)).astype(np.float32)
    simplified = cv2.approxPolyDP(contour, max(0.1, max_error), False)
    return simplified.reshape((-1, 2))


def _cubic_path(points: np.ndarray) -> str:
    if len(points) == 0:
        return ""
    if len(points) == 1:
        x, y = points[0]
        return f"M {x:.3f} {y:.3f}"
    commands = [f"M {points[0, 0]:.3f} {points[0, 1]:.3f}"]
    tangents = _tangents(points)
    for i in range(len(points) - 1):
        p0, p1 = points[i], points[i + 1]
        control1 = p0 + tangents[i] / 3.0
        control2 = p1 - tangents[i + 1] / 3.0
        commands.append(
            "C "
            f"{control1[0]:.3f} {control1[1]:.3f} "
            f"{control2[0]:.3f} {control2[1]:.3f} "
            f"{p1[0]:.3f} {p1[1]:.3f}"
        )
    return " ".join(commands)


def _tangents(points: np.ndarray) -> np.ndarray:
    tangents = np.zeros_like(points, dtype=np.float32)
    if len(points) < 2:
        return tangents
    tangents[0] = points[1] - points[0]
    tangents[-1] = points[-1] - points[-2]
    for index in range(1, len(points) - 1):
        incoming = points[index] - points[index - 1]
        outgoing = points[index + 1] - points[index]
        tangent = (points[index + 1] - points[index - 1]) / 2.0
        if np.any(incoming * outgoing <= 0):
            tangents[index] = 0
            continue
        for axis in range(2):
            limit = 3.0 * min(abs(incoming[axis]), abs(outgoing[axis]))
            tangent[axis] = np.sign(tangent[axis]) * min(abs(tangent[axis]), limit)
        tangents[index] = tangent
    return tangents


def _polyline_fit_error(points: np.ndarray, simplified: np.ndarray) -> float:
    if len(points) < 2 or len(simplified) < 2:
        return 0.0
    starts = simplified[:-1]
    vectors = simplified[1:] - starts
    lengths_squared = np.sum(vectors * vectors, axis=1)
    maximum = 0.0
    for offset in range(0, len(points), 256):
        chunk = points[offset : offset + 256]
        relative = chunk[:, None, :] - starts[None, :, :]
        projection = np.sum(relative * vectors[None, :, :], axis=2) / np.maximum(
            lengths_squared[None, :], 1e-8
        )
        projection = np.clip(projection, 0.0, 1.0)
        nearest = starts[None, :, :] + projection[:, :, None] * vectors[None, :, :]
        distances = np.linalg.norm(chunk[:, None, :] - nearest, axis=2)
        maximum = max(maximum, float(np.max(np.min(distances, axis=1))))
    return maximum


def _closed_paths(mask: np.ndarray, max_error: float) -> tuple[list[str], int]:
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    paths: list[str] = []
    perimeter_error = 0.0
    perimeter_total = 0.0
    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        if perimeter < 4:
            continue
        simplified = cv2.approxPolyDP(contour, max(0.1, max_error), True).reshape((-1, 2))
        if len(simplified) < 3:
            continue
        path = "M " + " L ".join(f"{x:.3f} {y:.3f}" for x, y in simplified) + " Z"
        paths.append(path)
        perimeter_error += abs(perimeter - cv2.arcLength(simplified.reshape((-1, 1, 2)), True))
        perimeter_total += perimeter
    return paths, int(255 * min(1.0, perimeter_error / max(1.0, perimeter_total)))


def extract(payload: dict[str, Any]) -> dict[str, Any]:
    config = ExtractionConfig(
        mode=payload.get("mode", "open"),
        threshold=float(payload.get("threshold", 36)),
        max_error=float(payload.get("maxError", 1.5)),
        color=payload.get("color"),
    )
    if config.mode not in {"open", "closed"}:
        raise ValueError("mode must be 'open' or 'closed'.")
    crop, source_bbox = _load_crop(payload)
    mask, rgb_color = _foreground_mask(crop, config)
    height, width = mask.shape
    if cv2.countNonZero(mask) == 0:
        raise ValueError(
            "No foreground geometry was detected; provide a color or lower the threshold."
        )
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    skeleton = skeletonize(mask > 0)
    widths = distance[skeleton]
    stroke_width = float(np.median(widths) * 2) if len(widths) else 1.0
    paint = f"#{rgb_color[0]:02x}{rgb_color[1]:02x}{rgb_color[2]:02x}"
    warnings: list[str] = []
    if config.mode == "open":
        points = _ordered_skeleton(mask)
        simplified = _simplify(points, config.max_error)
        fit_error = _polyline_fit_error(points, simplified)
        path_data = _cubic_path(simplified)
        body = (
            f'<path d="{path_data}" fill="none" stroke="{paint}" '
            f'stroke-width="{stroke_width:.3f}" stroke-linecap="round" '
            'stroke-linejoin="round"/>'
        )
        if len(points) < 4:
            warnings.append(
                "The selected region contains too few centerline samples for a stable curve fit."
            )
        fill_rule = "nonzero"
    else:
        paths, contour_error = _closed_paths(mask, config.max_error)
        path_data = " ".join(paths)
        fit_error = contour_error / 255
        body = f'<path d="{path_data}" fill="{paint}" fill-rule="evenodd" stroke="none"/>'
        fill_rule = "evenodd"
        if not paths:
            raise ValueError("No closed contours were found in the selected region.")
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">{body}</svg>'
    )
    artifact_path = Path(payload["artifactPath"])
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text(svg, encoding="utf-8")
    rgb_crop = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
    background_border = np.concatenate(
        (rgb_crop[0], rgb_crop[-1], rgb_crop[:, 0], rgb_crop[:, -1]), axis=0
    )
    background_color = np.median(background_border, axis=0)
    return {
        "svg": svg,
        "artifactPath": str(artifact_path),
        "sourceBbox": list(source_bbox),
        "viewBox": [0, 0, width, height],
        "paint": {
            "color": paint,
            "strokeWidth": stroke_width if config.mode == "open" else None,
            "fillRule": fill_rule,
        },
        "fitError": fit_error,
        "backgroundColor": "#" + "".join(f"{int(value):02x}" for value in background_color),
        "foregroundPixels": int(cv2.countNonZero(mask)),
        "warnings": warnings,
    }


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        print(json.dumps({"ok": True, "result": extract(payload)}))
    except Exception as error:  # the worker returns actionable, transport-safe diagnostics
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
