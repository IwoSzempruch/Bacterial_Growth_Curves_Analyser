import json
import os
import math
from statistics import median

import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter.scrolledtext import ScrolledText

import matplotlib.pyplot as plt


# ====== KONFIGURACJA DOMYŚLNA ======

DEFAULT_SMOOTHED_PATH = r"C:\Users\iwosz\Downloads\LB_800_834-smoothed (2).json"

# domyślne parametry analizy fazy log
DEFAULT_WINDOW_SIZE = 5      # liczba punktów w oknie regresji
DEFAULT_R2_MIN = 0.98        # minimalne R^2, żeby okno uznać za "prawie liniowe" w log-skali
DEFAULT_OD_MIN = 0.01        # minimalny OD, żeby w ogóle brać punkt pod uwagę
DEFAULT_FRAC_K_MAX = 0.4     # maks. frakcja plateau (K_est), przy której jeszcze dopuszczamy okno
DEFAULT_MU_REL_MIN = 0.8     # dolna granica µ / µ_max dla log-fazy
DEFAULT_MU_REL_MAX = 1.05    # górna granica µ / µ_max dla log-fazy


# ====== WCZYTYWANIE PLIKU SMOOTHED ======

def load_smoothed(path: str):
    """Wczytuje plik *.smoothed.json (SmoothedCurvesPayload)."""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Plik nie istnieje: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_samples(smoothed_payload):
    """
    Zwraca posortowaną listę nazw próbek z pola 'samples[*].sample'.
    """
    samples = smoothed_payload.get("samples", [])
    names = []
    for s in samples:
        name = s.get("sample")
        if name:
            names.append(name)
    return sorted(set(names))


def get_sample_entry(smoothed_payload, sample_name: str):
    """Zwraca obiekt próbki o zadanej nazwie."""
    for s in smoothed_payload.get("samples", []):
        if s.get("sample") == sample_name:
            return s
    raise ValueError(f"Brak sample='{sample_name}' w pliku smoothed.")


def list_history_labels(sample_entry):
    """
    Zwraca listę labeli z sekcji history dla danej próbki.
    history[*].label
    """
    labels = []
    for h in sample_entry.get("history", []):
        label = h.get("label")
        if label:
            labels.append(label)
    return labels


def get_curve_for_sample_history(sample_entry, history_label: str | None = None):
    """
    Zwraca (t, y, selected_label, wells_info) dla danej próbki i wybranego wariantu history.
    Jeżeli history_label jest None, wybiera ostatni wariant (najbardziej "aktualny").
    """
    history = sample_entry.get("history", [])
    if not history:
        raise ValueError("Brak sekcji 'history' dla tej próbki.")

    # wybór wariantu
    selected_history = None
    if history_label is None:
        selected_history = history[-1]
    else:
        for h in history:
            if h.get("label") == history_label:
                selected_history = h
                break

    if selected_history is None:
        raise ValueError(f"Brak history.label='{history_label}' dla tej próbki.")

    points = selected_history.get("points", [])
    if not points:
        raise ValueError("Wybrany wariant history nie zawiera punktów.")

    t = [p["x"] for p in points]
    y = [p["y"] for p in points]

    wells = sample_entry.get("wells", [])
    wells_info = ", ".join(
        f"{w.get('well')} (rep {w.get('replicate')})" for w in wells
    ) or "brak"

    return t, y, selected_history.get("label", ""), wells_info


# ====== ANALIZA FAZY LOG ======

def _linear_regression(T, U):
    """Prosty OLS: zwraca (slope, intercept, R^2)."""
    n = len(T)
    if n < 2:
        return None, None, None

    mean_t = sum(T) / n
    mean_u = sum(U) / n

    s_tt = 0.0
    s_tu = 0.0
    for ti, ui in zip(T, U):
        dt = ti - mean_t
        du = ui - mean_u
        s_tt += dt * dt
        s_tu += dt * du

    if s_tt == 0:
        return None, None, None

    slope = s_tu / s_tt
    intercept = mean_u - slope * mean_t

    # R^2
    ss_tot = sum((ui - mean_u) ** 2 for ui in U)
    ss_res = sum((ui - (slope * ti + intercept)) ** 2 for ti, ui in zip(T, U))
    if ss_tot == 0:
        r2 = 1.0
    else:
        r2 = 1 - ss_res / ss_tot

    return slope, intercept, r2


def detect_log_phase(
    t,
    y,
    window_size=DEFAULT_WINDOW_SIZE,
    r2_min=DEFAULT_R2_MIN,
    od_min=DEFAULT_OD_MIN,
    frac_k_max=DEFAULT_FRAC_K_MAX,
    mu_rel_min=DEFAULT_MU_REL_MIN,
    mu_rel_max=DEFAULT_MU_REL_MAX,
):
    """
    Wykrywa fazę log w pojedynczej krzywej wzrostu.

    Zakładamy:
    - dane są już po blankowaniu i wygładzaniu,
    - usunięte spike'i (przebieg monotoniczny / prawie monotoniczny).

    Zwraca:
        log_indices : list[int]   # indeksy punktów należących do fazy log
        mu_max      : float | None
        mu_mean     : float | None
        K_est       : float | None
    """
    n = len(t)
    if n == 0:
        return [], None, None, None

    # 1. Odcinamy bardzo małe OD (poniżej od_min)
    valid_indices = [i for i, val in enumerate(y) if val >= od_min]
    if len(valid_indices) < window_size + 1:
        return [], None, None, None

    # 2. Szacujemy K z końca krzywej (median z ostatnich ~5 wartości w valid_indices)
    tail = valid_indices[-5:] if len(valid_indices) >= 5 else valid_indices
    tail_vals = [y[i] for i in tail]
    K_est = median(tail_vals) if tail_vals else None
    if K_est is None or K_est <= 0:
        return [], None, None, None

    # 3. Sliding window w log-skali
    good_windows = []  # elementy: (start_idx, end_idx, mu, r2)

    for k in range(0, len(valid_indices) - window_size + 1):
        idxs = valid_indices[k: k + window_size]
        T = [t[i] for i in idxs]
        Y = [y[i] for i in idxs]

        # warunek "daleko od plateau"
        if max(Y) / K_est >= frac_k_max:
            continue

        # log-transform; jeśli jakiekolwiek Y <= 0, to to okno pomijamy
        if any(val <= 0 for val in Y):
            continue
        U = [math.log(val) for val in Y]

        slope, intercept, r2 = _linear_regression(T, U)
        if slope is None or r2 is None:
            continue
        if slope <= 0:
            continue
        if r2 < r2_min:
            continue

        good_windows.append((idxs[0], idxs[-1], slope, r2))

    if not good_windows:
        return [], None, None, K_est

    # 4. µ_max = max slope
    mu_max = max(win[2] for win in good_windows)

    # 5. wybieramy okna z µ bliską µ_max
    log_windows = [
        win for win in good_windows
        if mu_rel_min * mu_max <= win[2] <= mu_rel_max * mu_max
    ]
    if not log_windows:
        # fallback: przynajmniej okno z µ_max
        log_windows = [max(good_windows, key=lambda w: w[2])]

    # 6. budujemy maskę "czy punkt jest w log-fazie"
    is_log = [False] * n
    for start_idx, end_idx, slope, r2 in log_windows:
        for i in range(start_idx, end_idx + 1):
            is_log[i] = True

    # 7. szukamy ciągłych runów
    runs = []
    current = []
    for i, flag in enumerate(is_log):
        if flag:
            current.append(i)
        elif current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)

    if not runs:
        return [], mu_max, None, K_est

    # wybieramy najdłuższy run jako główną fazę log
    log_indices = max(runs, key=len)

    # 8. obliczamy µ_mean z okien, które nachodzą na ten run
    mus_in_run = []
    for start_idx, end_idx, slope, r2 in log_windows:
        if not (end_idx < log_indices[0] or start_idx > log_indices[-1]):
            mus_in_run.append(slope)

    mu_mean = sum(mus_in_run) / len(mus_in_run) if mus_in_run else mu_max

    return log_indices, mu_max, mu_mean, K_est


def plot_log_phase(t, y, log_indices, mu_max, mu_mean, K_est, title=""):
    """Rysuje krzywą wzrostu z zaznaczoną fazą log."""
    plt.figure(figsize=(10, 5))
    plt.scatter(t, y, s=35, alpha=0.7, label="OD (smoothed)")

    if log_indices:
        t_log = [t[i] for i in log_indices]
        y_log = [y[i] for i in log_indices]
        plt.scatter(
            t_log,
            y_log,
            s=120,
            facecolors="none",
            edgecolors="green",
            linewidths=2,
            label="faza log (auto)",
        )

    if K_est is not None:
        plt.axhline(K_est, linestyle="--", color="grey", label=f"K_est ~ {K_est:.3f}")

    plt.xlabel("time [min]")
    plt.ylabel("OD")
    plt.title(title)

    header = []
    if mu_max is not None:
        header.append(f"µ_max ~ {mu_max:.4f} 1/min")
    if mu_mean is not None:
        header.append(f"µ_mean (log) ~ {mu_mean:.4f}")
    if header:
        plt.suptitle(" | ".join(header), fontsize=9, y=0.98)

    plt.legend()
    plt.tight_layout()
    plt.show()


# ====== GUI ======

class LogPhaseSmoothedApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Log phase detection tester (smoothed curves)")

        self.data = None

        self.file_var = tk.StringVar(value=DEFAULT_SMOOTHED_PATH)
        self.sample_var = tk.StringVar()
        self.history_var = tk.StringVar()
        self.status_var = tk.StringVar(value="Nie wczytano pliku")

        # parametry log-fazy
        self.window_size_var = tk.StringVar(value=str(DEFAULT_WINDOW_SIZE))
        self.r2_min_var = tk.StringVar(value=str(DEFAULT_R2_MIN))
        self.od_min_var = tk.StringVar(value=str(DEFAULT_OD_MIN))
        self.frac_k_max_var = tk.StringVar(value=str(DEFAULT_FRAC_K_MAX))
        self.mu_rel_min_var = tk.StringVar(value=str(DEFAULT_MU_REL_MIN))
        self.mu_rel_max_var = tk.StringVar(value=str(DEFAULT_MU_REL_MAX))

        self._build_ui()
        self._auto_load_default()

    def _build_ui(self):
        # --- plik ---
        file_frame = ttk.LabelFrame(self.root, text="Plik *.smoothed.json")
        file_frame.pack(fill="x", padx=10, pady=10)

        ttk.Label(file_frame, text="Ścieżka:").grid(row=0, column=0, sticky="w", padx=5, pady=5)
        entry = ttk.Entry(file_frame, textvariable=self.file_var, width=70)
        entry.grid(row=0, column=1, sticky="ew", padx=5, pady=5)
        file_frame.columnconfigure(1, weight=1)

        ttk.Button(file_frame, text="Wybierz...", command=self._browse_file).grid(
            row=0, column=2, padx=5, pady=5
        )
        ttk.Button(file_frame, text="Wczytaj", command=self._load_from_entry).grid(
            row=0, column=3, padx=5, pady=5
        )

        ttk.Label(file_frame, textvariable=self.status_var, foreground="blue").grid(
            row=1, column=0, columnspan=4, sticky="w", padx=5, pady=(0, 5)
        )

        # --- wybór sample / history ---
        selection_frame = ttk.LabelFrame(self.root, text="Wybór sample / krzywej")
        selection_frame.pack(fill="x", padx=10, pady=5)

        ttk.Label(selection_frame, text="Sample:").grid(row=0, column=0, sticky="w", padx=5, pady=5)
        self.sample_combo = ttk.Combobox(
            selection_frame, textvariable=self.sample_var, state="readonly", width=25
        )
        self.sample_combo.grid(row=0, column=1, sticky="ew", padx=5, pady=5)
        self.sample_combo.bind("<<ComboboxSelected>>", lambda _e: self._on_sample_selected())

        ttk.Label(selection_frame, text="Krzywa (history):").grid(
            row=0, column=2, sticky="w", padx=5, pady=5
        )
        self.history_combo = ttk.Combobox(
            selection_frame, textvariable=self.history_var, state="readonly", width=30
        )
        self.history_combo.grid(row=0, column=3, sticky="w", padx=5, pady=5)

        self.analyze_button = ttk.Button(
            selection_frame, text="Analizuj fazę log", command=self._run_analysis, state="disabled"
        )
        self.analyze_button.grid(row=0, column=4, padx=5, pady=5)

        selection_frame.columnconfigure(1, weight=1)

        # --- parametry log-fazy ---
        params_frame = ttk.LabelFrame(self.root, text="Parametry wykrywania fazy log")
        params_frame.pack(fill="x", padx=10, pady=5)

        # wiersz 0
        ttk.Label(params_frame, text="window_size:").grid(row=0, column=0, sticky="w", padx=5, pady=3)
        ttk.Entry(params_frame, textvariable=self.window_size_var, width=6).grid(
            row=0, column=1, sticky="w", padx=5, pady=3
        )

        ttk.Label(params_frame, text="R² min:").grid(row=0, column=2, sticky="w", padx=5, pady=3)
        ttk.Entry(params_frame, textvariable=self.r2_min_var, width=6).grid(
            row=0, column=3, sticky="w", padx=5, pady=3
        )

        ttk.Label(params_frame, text="OD_min:").grid(row=0, column=4, sticky="w", padx=5, pady=3)
        ttk.Entry(params_frame, textvariable=self.od_min_var, width=6).grid(
            row=0, column=5, sticky="w", padx=5, pady=3
        )

        # wiersz 1
        ttk.Label(params_frame, text="frac_K_max:").grid(row=1, column=0, sticky="w", padx=5, pady=3)
        ttk.Entry(params_frame, textvariable=self.frac_k_max_var, width=6).grid(
            row=1, column=1, sticky="w", padx=5, pady=3
        )

        ttk.Label(params_frame, text="µ_rel_min:").grid(row=1, column=2, sticky="w", padx=5, pady=3)
        ttk.Entry(params_frame, textvariable=self.mu_rel_min_var, width=6).grid(
            row=1, column=3, sticky="w", padx=5, pady=3
        )

        ttk.Label(params_frame, text="µ_rel_max:").grid(row=1, column=4, sticky="w", padx=5, pady=3)
        ttk.Entry(params_frame, textvariable=self.mu_rel_max_var, width=6).grid(
            row=1, column=5, sticky="w", padx=5, pady=3
        )

        # --- wyniki ---
        output_frame = ttk.LabelFrame(self.root, text="Wyniki")
        output_frame.pack(fill="both", expand=True, padx=10, pady=(5, 10))

        self.output = ScrolledText(output_frame, width=80, height=14, state="disabled")
        self.output.pack(fill="both", expand=True, padx=5, pady=5)

    def _auto_load_default(self):
        path = self.file_var.get().strip()
        if path:
            try:
                self._load_json(path)
            except Exception as exc:
                self.status_var.set(f"Nie udało się wczytać pliku: {exc}")

    def _browse_file(self):
        path = filedialog.askopenfilename(
            title="Wybierz plik *.smoothed.json",
            filetypes=[("Smoothed JSON", "*.smoothed.json;*.json"), ("Wszystkie pliki", "*.*")],
        )
        if path:
            self.file_var.set(path)
            self._load_from_entry()

    def _load_from_entry(self):
        path = self.file_var.get().strip()
        if not path:
            messagebox.showinfo("Brak pliku", "Podaj ścieżkę do pliku *.smoothed.json.")
            return
        try:
            self._load_json(path)
        except Exception as exc:
            messagebox.showerror("Błąd", str(exc))

    def _load_json(self, path):
        self.data = load_smoothed(path)

        sample_names = list_samples(self.data)
        self.sample_combo["values"] = sample_names
        self.sample_var.set(sample_names[0] if sample_names else "")
        self._on_sample_selected()

        self.status_var.set(f"Wczytano {os.path.basename(path)}")
        self._write_output(
            f"Wczytano plik: {path}\nSamples: {', '.join(sample_names) or 'brak'}"
        )

    def _on_sample_selected(self):
        if not self.data:
            return
        sample_name = self.sample_var.get()
        if not sample_name:
            self.history_combo["values"] = []
            self.history_var.set("")
            self._update_button_state()
            return

        try:
            sample_entry = get_sample_entry(self.data, sample_name)
        except Exception as exc:
            messagebox.showerror("Błąd", str(exc))
            return

        labels = list_history_labels(sample_entry)
        self.history_combo["values"] = labels
        # domyślnie ostatni wariant (najbardziej "aktualny")
        if labels:
            self.history_var.set(labels[-1])
        else:
            self.history_var.set("")

        self._update_button_state()

    def _update_button_state(self):
        state = "normal" if (self.data and self.sample_var.get() and self.history_var.get()) else "disabled"
        self.analyze_button.configure(state=state)

    def _run_analysis(self):
        if not self.data:
            messagebox.showinfo("Brak danych", "Najpierw wczytaj plik smoothed.")
            return

        sample_name = self.sample_var.get()
        history_label = self.history_var.get()

        # parsowanie parametrów z UI
        try:
            window_size = int(self.window_size_var.get())
            r2_min = float(self.r2_min_var.get())
            od_min = float(self.od_min_var.get())
            frac_k_max = float(self.frac_k_max_var.get())
            mu_rel_min = float(self.mu_rel_min_var.get())
            mu_rel_max = float(self.mu_rel_max_var.get())
        except ValueError:
            messagebox.showerror(
                "Błąd parametrów",
                "Nieprawidłowe wartości parametrów (window_size, R², OD itd.).",
            )
            return

        try:
            sample_entry = get_sample_entry(self.data, sample_name)
            t, y, selected_label, wells_info = get_curve_for_sample_history(
                sample_entry, history_label
            )
        except Exception as exc:
            messagebox.showerror("Błąd danych", str(exc))
            return

        log_indices, mu_max, mu_mean, K_est = detect_log_phase(
            t,
            y,
            window_size=window_size,
            r2_min=r2_min,
            od_min=od_min,
            frac_k_max=frac_k_max,
            mu_rel_min=mu_rel_min,
            mu_rel_max=mu_rel_max,
        )

        lines = [
            f"Sample: {sample_name}",
            f"Krzywa (history): {selected_label}",
            f"Wells: {wells_info}",
            f"Liczba punktów: {len(t)}",
            "",
            f"K_est (plateau): {K_est:.5f}" if K_est is not None else "K_est: brak",
            f"µ_max (1/min): {mu_max:.5f}" if mu_max is not None else "µ_max: brak",
            f"µ_mean (log-faza): {mu_mean:.5f}" if mu_mean is not None else "µ_mean: brak",
            f"Liczba punktów w log-fazie: {len(log_indices)}",
        ]

        if log_indices:
            times_log = [t[i] for i in log_indices]
            vals_log = [y[i] for i in log_indices]
            lines.append(f"Czasy log-fazy: {times_log}")
            lines.append(f"OD log-fazy: {vals_log}")

        self._write_output("\n".join(lines))

        title = f"sample={sample_name}, history='{selected_label}'"
        plot_log_phase(t, y, log_indices, mu_max, mu_mean, K_est, title=title)

    def _write_output(self, text):
        self.output.configure(state="normal")
        self.output.delete("1.0", tk.END)
        self.output.insert(tk.END, text)
        self.output.configure(state="disabled")


def main():
    root = tk.Tk()
    LogPhaseSmoothedApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
