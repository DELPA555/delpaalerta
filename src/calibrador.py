"""Herramienta de calibración: saca una captura REAL de la pantalla y te deja
hacer click para leer el color RGB exacto de ese píxel (para recalibrar si
cambia el diseño de WhatsApp o de la app de escritorio remoto).

Uso:  AlertaPantalla.exe --calibrar
  - Click simple  -> muestra el RGB del píxel y un rango sugerido para el config.
  - Arrastrar     -> muestra una región {top,left,width,height} para vigilar.
  - Esc           -> salir.
"""
import os
import tempfile
import tkinter as tk
from tkinter import messagebox

import numpy as np
import mss
import mss.tools


def run_calibrador() -> None:
    with mss.mss() as sct:
        mon = sct.monitors[1]  # monitor principal
        shot = sct.grab(mon)
        arr = np.array(shot)  # BGRA, alto x ancho x 4
        png_path = os.path.join(tempfile.gettempdir(), "alerta_calibrar.png")
        mss.tools.to_png(shot.rgb, shot.size, output=png_path)

    root = tk.Tk()
    root.title("AlertaPantalla — Calibrador (click = color, arrastrar = región, Esc = salir)")
    root.attributes("-fullscreen", True)
    root.configure(cursor="crosshair")

    img = tk.PhotoImage(file=png_path)
    canvas = tk.Canvas(root, highlightthickness=0)
    canvas.pack(fill="both", expand=True)
    canvas.create_image(0, 0, anchor="nw", image=img)

    info = canvas.create_text(
        14, 14, anchor="nw", fill="#00ff88",
        font=("Consolas", 14, "bold"), text="Mové el mouse…",
    )
    canvas.tag_raise(info)

    state = {"x0": 0, "y0": 0, "rect": None}
    H, W = arr.shape[0], arr.shape[1]

    def rgb_en(x: int, y: int):
        x = max(0, min(W - 1, x))
        y = max(0, min(H - 1, y))
        b, g, r = int(arr[y, x, 0]), int(arr[y, x, 1]), int(arr[y, x, 2])
        return r, g, b

    def on_move(e):
        r, g, b = rgb_en(e.x, e.y)
        canvas.itemconfig(info, text=f"x={e.x}  y={e.y}   RGB=({r}, {g}, {b})")

    def on_press(e):
        state["x0"], state["y0"] = e.x, e.y
        if state["rect"]:
            canvas.delete(state["rect"])
        state["rect"] = canvas.create_rectangle(e.x, e.y, e.x, e.y, outline="#00ff88", width=2)

    def on_drag(e):
        if state["rect"]:
            canvas.coords(state["rect"], state["x0"], state["y0"], e.x, e.y)

    def on_release(e):
        dx, dy = abs(e.x - state["x0"]), abs(e.y - state["y0"])
        if dx < 5 and dy < 5:
            # Click simple -> color
            r, g, b = rgb_en(e.x, e.y)
            tol = 30
            lo = [max(0, r - tol), max(0, g - tol), max(0, b - tol)]
            hi = [min(255, r + tol), min(255, g + tol), min(255, b + tol)]
            messagebox.showinfo(
                "Color del píxel",
                f"RGB = ({r}, {g}, {b})\n\n"
                f"Sugerido para config.json (tolerancia ±{tol}):\n"
                f'  "color_rgb_min": {lo},\n'
                f'  "color_rgb_max": {hi}',
            )
        else:
            top, left = min(state["y0"], e.y), min(state["x0"], e.x)
            width, height = dx, dy
            messagebox.showinfo(
                "Región seleccionada",
                "Pegá esto en config.json (y monitor:1):\n\n"
                f'  "region": {{"top": {top}, "left": {left}, '
                f'"width": {width}, "height": {height}}}',
            )

    canvas.bind("<Motion>", on_move)
    canvas.bind("<ButtonPress-1>", on_press)
    canvas.bind("<B1-Motion>", on_drag)
    canvas.bind("<ButtonRelease-1>", on_release)
    root.bind("<Escape>", lambda e: root.destroy())
    root.mainloop()
