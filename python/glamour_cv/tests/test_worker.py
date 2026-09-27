from __future__ import annotations

import cv2
import numpy as np

from glamour_cv.worker import extract


def _fixture(tmp_path, closed: bool) -> dict:
    image = np.full((120, 180, 3), 255, dtype=np.uint8)
    if closed:
        cv2.circle(image, (90, 60), 25, (20, 90, 220), -1)
        mode = "closed"
    else:
        cv2.line(image, (20, 90), (80, 40), (20, 90, 220), 5)
        cv2.line(image, (80, 40), (150, 50), (20, 90, 220), 5)
        mode = "open"
    path = tmp_path / f"{mode}.png"
    cv2.imwrite(str(path), image)
    return {
        "sourcePath": str(path),
        "bbox": [0, 0, 180, 120],
        "mode": mode,
        "color": "#dc5a14",
        "artifactPath": str(tmp_path / f"{mode}.svg"),
    }


def test_open_stroke_produces_svg_and_metadata(tmp_path):
    result = extract(_fixture(tmp_path, False))
    assert "<path" in result["svg"]
    assert "stroke-width" in result["svg"]
    assert result["viewBox"] == [0, 0, 180, 120]
    assert result["foregroundPixels"] > 100
    assert (tmp_path / "open.svg").exists()


def test_closed_shape_preserves_closed_path(tmp_path):
    result = extract(_fixture(tmp_path, True))
    assert " Z" in result["svg"]
    assert 'fill-rule="evenodd"' in result["svg"]
