import json
import os
from collections import defaultdict
from statistics import median
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter.scrolledtext import ScrolledText

import matplotlib.pyplot as plt


DEFAULT_JSON_PATH = r"C:\Users\iwosz\Downloads\LB_800_834.assignment.json"
T_PRE = 45.0
BIN_WIDTH = 0.001
TOL = 0.001
MIN_CONSECUTIVE = 3
# tolerancja na spadek przy liczeniu sekwencji niemalejącej (dla LNDS)
MONO_EPS = 0.000
# maksymalny czas (minuty), do którego wymuszamy sekwencję niemalejącą
# (po tym czasie zakładamy fazę stacjonarną i nie czyścimy "ząbków")
MONO_T_MAX = 400.0


def get_dataset_rows(data):
    """Return dataset.rows regardless of whether it sits at root or inside assignments."""
    dataset = data.get("dataset")
    if not dataset:
        for assignment in data.get("assignments", []):
            dataset = assignment.get("dataset")
            if dataset:
                break
    if not dataset or "rows" not in dataset:
        raise KeyError("Brak danych 'dataset.rows' w pliku assignment")
    return dataset["rows"]


def load_assignment(path: str):
    """Load assignment JSON file."""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Plik nie istnieje: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_samples_and_wells_from_mapping(data):
    """Return mapping sample -> sorted list of wells."""
    sample_to_wells = defaultdict(set)

    assignments = data.get("assignments", [])
    mapping_samples = None
    if assignments:
        mapping = assignments[0].get("mapping", {})
        mapping_samples = mapping.get("samples")

    if mapping_samples:
        for sample in mapping_samples:
            name = sample.get("name")
            wells = sample.get("wells", [])
            if name:
                for well in wells:
                    sample_to_wells[name].add(well)
    else:
        rows = get_dataset_rows(data)
        for row in rows:
            sample_name = row.get("sample")
            well = row.get("well")
            if sample_name and well:
                sample_to_wells[sample_name].add(well)

    return {name: sorted(list(wells)) for name, wells in sample_to_wells.items()}


def get_time_series_for_well(data, well: str):
    """Return time series for a single well."""
    rows = get_dataset_rows(data)
    t = []
    y = []
    sample_name = None
    replicates = set()

    for row in rows:
        if row.get("well") != well:
            continue
        t.append(row["time_min"])
        y.append(row["val_od600"])
        replicates.add(row.get("replicate"))
        if sample_name is None:
            sample_name = row.get("sample")

    if not t:
        raise ValueError(f"Brak danych dla wella {well}")

    combined = sorted(zip(t, y), key=lambda xy: xy[0])
    t_sorted, y_sorted = zip(*combined)
    return list(t_sorted), list(y_sorted), sample_name, replicates


def find_baseline_points(
    t,
    y,
    t_pre=T_PRE,
    bin_width=BIN_WIDTH,
    tol=TOL,
    min_consecutive=MIN_CONSECUTIVE,
):
    """Find baseline indices, baseline level and indices to exclude."""
    pre_indices = [i for i, ti in enumerate(t) if ti <= t_pre]
    if len(pre_indices) < min_consecutive:
        return [], None, []

    y_pre = [y[i] for i in pre_indices]
    y_min = min(y_pre)
    bins_dict = defaultdict(list)

    for idx in pre_indices:
        val = y[idx]
        bin_index = int((val - y_min) / bin_width)
        bins_dict[bin_index].append(idx)

    if not bins_dict:
        return [], None, []

    _, best_indices = max(bins_dict.items(), key=lambda kv: len(kv[1]))
    baseline_values = [y[i] for i in best_indices]
    baseline_level = median(baseline_values)

    candidate_indices = sorted(i for i in pre_indices if abs(y[i] - baseline_level) <= tol)
    if not candidate_indices:
        return [], baseline_level, []

    runs = []
    current_run = [candidate_indices[0]]
    for idx in candidate_indices[1:]:
        if idx == current_run[-1] + 1:
            current_run.append(idx)
        else:
            runs.append(current_run)
            current_run = [idx]
    runs.append(current_run)

    valid_runs = [run for run in runs if len(run) >= min_consecutive]
    if not valid_runs:
        baseline_indices = candidate_indices
    else:
        baseline_indices = max(valid_runs, key=len)

    excluded_pre_indices = []
    if baseline_indices:
        earliest_baseline_idx = min(baseline_indices)
        for idx in pre_indices:
            if idx < earliest_baseline_idx and abs(y[idx] - baseline_level) > tol:
                excluded_pre_indices.append(idx)

    excluded_indices = set(excluded_pre_indices)

    if not baseline_indices:
        return baseline_indices, baseline_level, sorted(excluded_indices)

    start_idx = min(baseline_indices)
    mono_indices = [
        i
        for i in range(start_idx, len(y))
        if t[i] <= MONO_T_MAX and i not in excluded_indices
    ]

    if len(mono_indices) <= 1:
        return baseline_indices, baseline_level, sorted(excluded_indices)

    vals = [y[i] for i in mono_indices]
    m = len(vals)
    dp_len = [1] * m
    prev_idx = [-1] * m

    best_end = 0
    for j in range(m):
        for i in range(j):
            if vals[i] <= vals[j] + MONO_EPS and dp_len[i] + 1 > dp_len[j]:
                dp_len[j] = dp_len[i] + 1
                prev_idx[j] = i
        if dp_len[j] > dp_len[best_end]:
            best_end = j

    keep_local_positions = set()
    k = best_end
    while k != -1:
        keep_local_positions.add(k)
        k = prev_idx[k]

    keep_global_indices = {mono_indices[pos] for pos in keep_local_positions}
    for idx in mono_indices:
        if idx not in keep_global_indices:
            excluded_indices.add(idx)

    return baseline_indices, baseline_level, sorted(excluded_indices)


def plot_baseline(t, y, baseline_indices, baseline_level, title="", excluded_indices=None):
    """Plot raw series with highlighted baseline points."""
    plt.figure(figsize=(10, 5))
    plt.scatter(t, y, s=35, alpha=0.7, label="OD600 (raw)")

    if baseline_indices:
        t_base = [t[i] for i in baseline_indices]
        y_base = [y[i] for i in baseline_indices]
        plt.scatter(
            t_base,
            y_base,
            s=140,
            facecolors="none",
            edgecolors="red",
            linewidths=2,
            label="baseline (kandydaci na blank)",
        )

    if excluded_indices:
        t_excl = [t[i] for i in excluded_indices]
        y_excl = [y[i] for i in excluded_indices]
        plt.scatter(
            t_excl,
            y_excl,
            s=80,
            marker="x",
            color="red",
            label="wykluczone z analizy (spike'i / niemonotoniczne)",
        )

    if baseline_level is not None:
        plt.axhline(baseline_level, linestyle="--", label=f"baseline ~ {baseline_level:.4f}")

    plt.xlabel("time [min]")
    plt.ylabel("OD600")
    plt.title(title)
    plt.legend()
    plt.tight_layout()
    plt.show()


class BaselineApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Blank selection helper")

        self.data = None
        self.sample_to_wells = {}

        self.file_var = tk.StringVar(value=DEFAULT_JSON_PATH)
        self.sample_var = tk.StringVar()
        self.well_var = tk.StringVar()
        self.status_var = tk.StringVar(value="Nie wczytano pliku")

        self._build_ui()
        self._auto_load_default()

    def _build_ui(self):
        file_frame = ttk.LabelFrame(self.root, text="Plik assignment JSON")
        file_frame.pack(fill="x", padx=10, pady=10)

        ttk.Label(file_frame, text="Sciezka:").grid(row=0, column=0, sticky="w", padx=5, pady=5)
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

        selection_frame = ttk.LabelFrame(self.root, text="Wybor sample / well")
        selection_frame.pack(fill="x", padx=10, pady=5)

        ttk.Label(selection_frame, text="Sample:").grid(row=0, column=0, sticky="w", padx=5, pady=5)
        self.sample_combo = ttk.Combobox(
            selection_frame, textvariable=self.sample_var, state="readonly", width=30
        )
        self.sample_combo.grid(row=0, column=1, sticky="ew", padx=5, pady=5)
        self.sample_combo.bind("<<ComboboxSelected>>", lambda _event: self._on_sample_selected())

        ttk.Label(selection_frame, text="Well:").grid(row=0, column=2, sticky="w", padx=5, pady=5)
        self.well_combo = ttk.Combobox(
            selection_frame, textvariable=self.well_var, state="readonly", width=10
        )
        self.well_combo.grid(row=0, column=3, sticky="w", padx=5, pady=5)
        self.well_combo.bind("<<ComboboxSelected>>", lambda _event: self._update_button_state())

        self.analyze_button = ttk.Button(
            selection_frame, text="Analizuj baseline", command=self._run_analysis, state="disabled"
        )
        self.analyze_button.grid(row=0, column=4, padx=5, pady=5)

        selection_frame.columnconfigure(1, weight=1)

        output_frame = ttk.LabelFrame(self.root, text="Wyniki")
        output_frame.pack(fill="both", expand=True, padx=10, pady=(5, 10))

        self.output = ScrolledText(output_frame, width=80, height=12, state="disabled")
        self.output.pack(fill="both", expand=True, padx=5, pady=5)

    def _auto_load_default(self):
        path = self.file_var.get().strip()
        if path:
            try:
                self._load_json(path)
            except Exception as exc:  # noqa: BLE001 - inform user
                self.status_var.set(f"Nie udalo sie wczytac pliku: {exc}")

    def _browse_file(self):
        path = filedialog.askopenfilename(
            title="Wybierz plik assignment JSON",
            filetypes=[("JSON", "*.json"), ("Wszystkie pliki", "*.*")],
        )
        if path:
            self.file_var.set(path)
            self._load_from_entry()

    def _load_from_entry(self):
        path = self.file_var.get().strip()
        if not path:
            messagebox.showinfo("Brak pliku", "Podaj sciezke do pliku JSON.")
            return
        try:
            self._load_json(path)
        except Exception as exc:  # noqa: BLE001 - show message box
            messagebox.showerror("Blad", str(exc))

    def _load_json(self, path):
        self.data = load_assignment(path)
        self.sample_to_wells = list_samples_and_wells_from_mapping(self.data)

        sample_names = sorted(self.sample_to_wells.keys())
        self.sample_combo["values"] = sample_names
        self.sample_var.set(sample_names[0] if sample_names else "")
        self._on_sample_selected()

        self.status_var.set(f"Wczytano {os.path.basename(path)}")
        self._write_output(f"Wczytano plik: {path}\nSamples: {', '.join(sample_names) or 'brak'}")

    def _on_sample_selected(self):
        sample = self.sample_var.get()
        wells = self.sample_to_wells.get(sample, [])
        self.well_combo["values"] = wells
        if wells:
            self.well_var.set(wells[0])
        else:
            self.well_var.set("")
        self._update_button_state()

    def _update_button_state(self):
        state = "normal" if (self.data and self.sample_var.get() and self.well_var.get()) else "disabled"
        self.analyze_button.configure(state=state)

    def _run_analysis(self):
        if not self.data:
            messagebox.showinfo("Brak danych", "Najpierw wczytaj plik assignment.")
            return

        well = self.well_var.get()
        sample_mapping = self.sample_var.get()
        try:
            t, y, dataset_sample, replicates = get_time_series_for_well(self.data, well)
        except Exception as exc:  # noqa: BLE001 - show message box
            messagebox.showerror("Brak danych", str(exc))
            return

        baseline_indices, baseline_level, excluded_indices = find_baseline_points(t, y)

        lines = [
            f"Sample (mapping): {sample_mapping}",
            f"Sample (dataset): {dataset_sample}",
            f"Well: {well}",
            f"Liczba punktow: {len(t)}",
            f"Replikaty: {', '.join(sorted(str(r) for r in replicates if r is not None)) or 'brak'}",
            f"Punkty baseline: {len(baseline_indices)}",
        ]
        if baseline_level is not None:
            lines.append(f"Poziom baseline: {baseline_level:.5f}")
        if baseline_indices:
            times = [t[i] for i in baseline_indices]
            values = [y[i] for i in baseline_indices]
            lines.append(f"Czasy baseline: {times}")
            lines.append(f"OD baseline: {values}")
        lines.append(f"Punkty wykluczone z analizy: {len(excluded_indices)}")
        if excluded_indices:
            excl_times = [t[i] for i in excluded_indices]
            excl_values = [y[i] for i in excluded_indices]
            lines.append(f"Czasy wykluczone: {excl_times}")
            lines.append(f"OD wykluczone: {excl_values}")

        self._write_output("\n".join(lines))

        title = f"sample={dataset_sample or sample_mapping}, well={well}"
        plot_baseline(t, y, baseline_indices, baseline_level, title=title, excluded_indices=excluded_indices)

    def _write_output(self, text):
        self.output.configure(state="normal")
        self.output.delete("1.0", tk.END)
        self.output.insert(tk.END, text)
        self.output.configure(state="disabled")


def main():
    root = tk.Tk()
    BaselineApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
