"""Detección de blobs verdes (círculos de no leídos) en un frame.

Pipeline:
  1. Máscara por rango de color RGB (config color_rgb_min/max).
  2. Componentes conexos (cv2.connectedComponentsWithStats).
  3. Filtro por área (config area_min/max) y "redondez" = min(w,h)/max(w,h)
     >= redondez_min. Se usa el aspecto del bounding box porque es robusto:
     el número blanco adentro del círculo "recorta" el disco verde y bajaría
     una circularidad basada en perímetro, pero el recuadro sigue siendo ~1:1.
  4. Devuelve la lista de centroides (x, y) de los blobs válidos.

Comparación entre frames: un blob es "nuevo" si su centroide no coincide
(dentro de tolerancia_posicion_px) con ningún centroide del frame anterior.
"""
from typing import List, Tuple

import numpy as np

try:
    import cv2
except Exception as e:  # pragma: no cover
    raise SystemExit("Falta OpenCV. Instalá con: pip install opencv-python\n" + str(e))

Point = Tuple[float, float]


class Detector:
    def __init__(self, cfg: dict):
        self.lo = np.array(cfg["color_rgb_min"], dtype=np.uint8)
        self.hi = np.array(cfg["color_rgb_max"], dtype=np.uint8)
        self.area_min = float(cfg["area_min"])
        self.area_max = float(cfg["area_max"])
        self.redondez_min = float(cfg["redondez_min"])
        self.tol = float(cfg["tolerancia_posicion_px"])

    def blobs(self, frame_rgb: np.ndarray) -> List[Point]:
        """frame_rgb: array HxWx3 en orden RGB. Devuelve centroides válidos."""
        mask = cv2.inRange(frame_rgb, self.lo, self.hi)
        num, _labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
        out: List[Point] = []
        for i in range(1, num):  # 0 = fondo
            x, y, w, h, area = stats[i]
            if area < self.area_min or area > self.area_max:
                continue
            if w == 0 or h == 0:
                continue
            aspecto = min(w, h) / max(w, h)
            if aspecto < self.redondez_min:
                continue
            cx, cy = centroids[i]
            out.append((float(cx), float(cy)))
        return out

    def nuevos(self, previos: List[Point], actuales: List[Point]) -> List[Point]:
        """Blobs de `actuales` que no estaban (por posición) en `previos`."""
        nuevos: List[Point] = []
        for a in actuales:
            if not any(_cerca(a, p, self.tol) for p in previos):
                nuevos.append(a)
        return nuevos


def _cerca(a: Point, b: Point, tol: float) -> bool:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 <= tol * tol


def bgra_a_rgb(frame_bgra: np.ndarray) -> np.ndarray:
    """mss entrega BGRA; devolvemos RGB contiguo para cv2.inRange."""
    return np.ascontiguousarray(frame_bgra[:, :, 2::-1])
