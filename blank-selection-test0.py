import json
import os
from collections import defaultdict
from statistics import median

import matplotlib.pyplot as plt


# === KONFIGURACJA DOMYŚLNA ===
DEFAULT_JSON_PATH = r"C:\Users\iwosz\Downloads\LB_800_834.assignment.json"

# Maksymalny czas (min), który traktujemy jako "przed wzrostem"
T_PRE = 45.0

# Szerokość binu histogramu (OD)
BIN_WIDTH = 0.001

# Tolerancja wokół poziomu zero (OD)
TOL = 0.001

# Minimalna liczba kolejnych punktów, żeby uznać ciąg za sensowny baseline
MIN_CONSECUTIVE = 3

# Maksymalny dopuszczalny spadek między kolejnymi punktami
MONO_EPS = 0.001


def get_dataset_rows(data):
    """
    Zapewnia dostęp do dataset.rows niezależnie od tego,
    czy dataset jest na poziomie głównym, czy w assignments[*].
    """
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
    """Wczytuje plik assignment JSON."""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Plik nie istnieje: {path}")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data


def list_samples_and_wells_from_mapping(data):
    """
    Czyta sekcję assignments[*].mapping.samples i zwraca:
    - sample -> lista wells
    Jeśli mapping jest inny niż oczekiwany, spróbuje zbudować mapę z dataset.rows.
    """
    sample_to_wells = defaultdict(set)

    assignments = data.get("assignments", [])
    mapping_samples = None
    if assignments:
        mapping = assignments[0].get("mapping", {})
        mapping_samples = mapping.get("samples")

    if mapping_samples:
        for s in mapping_samples:
            name = s.get("name")
            wells = s.get("wells", [])
            if name:
                for w in wells:
                    sample_to_wells[name].add(w)
    else:
        # fallback: budujemy sample->wells z dataset.rows
        rows = get_dataset_rows(data)
        for row in rows:
            sample = row.get("sample")
            well = row.get("well")
            if sample and well:
                sample_to_wells[sample].add(well)

    # zamieniamy sety na posortowane listy
    return {s: sorted(list(wells)) for s, wells in sample_to_wells.items()}


def get_time_series_for_well(data, well: str):
    """
    Pobiera serię (t, y) DLA JEDNEGO WELLA (nie miesza replikatów).
    Zwraca t, y, sample_name, replicate_values (set replikatów znalezionych w tym wellu).
    """
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


def find_baseline_points(t, y,
                         t_pre=T_PRE,
                         bin_width=BIN_WIDTH,
                         tol=TOL,
                         min_consecutive=MIN_CONSECUTIVE):
    """
    Algorytm:
    1. bierzemy punkty z t <= t_pre (pre-faza)
    2. robimy histogram z bin_width
    3. bierzemy bin z największą liczba punktów -> poziom zero
    4. wybieramy punkty w okolicy |y - B| <= tol
    5. szukamy najdłuższego ciągu kolejnych indeksów (min_consecutive)
    Zwraca:
    - indeksy baseline (w oryginalnej serii t, y),
    - poziom zero B
    """

    # 1. pre-faza
    pre_indices = [i for i, ti in enumerate(t) if ti <= t_pre]
    if len(pre_indices) < min_consecutive:
        print("Za mało punktów w pre-fazie, zwracam pusty baseline.")
        return [], None, []

    y_pre = [y[i] for i in pre_indices]

    # 2. histogram
    y_min = min(y_pre)
    bins_dict = defaultdict(list)  # bin_index -> lista indeksów (indeksy globalne)

    for idx in pre_indices:
        val = y[idx]
        bin_index = int((val - y_min) / bin_width)
        bins_dict[bin_index].append(idx)

    if not bins_dict:
        print("Histogram pusty (dziwne), zwracam pusty baseline.")
        return [], None, []

    # 3. bin z największą liczba punktów
    best_bin, best_indices = max(bins_dict.items(), key=lambda kv: len(kv[1]))
    baseline_values = [y[i] for i in best_indices]
    B = median(baseline_values)

    # 4. punkty w okolicy poziomu zero
    candidate_indices = sorted(
        i for i in pre_indices if abs(y[i] - B) <= tol
    )

    if not candidate_indices:
        print("Brak punktów w okolicy poziomu zero, zwracam pusty baseline.")
        return [], B, []

    # 5. szukamy najdłuższego ciągu kolejnych indeksów
    runs = []
    current_run = [candidate_indices[0]]

    for idx in candidate_indices[1:]:
        if idx == current_run[-1] + 1:
            current_run.append(idx)
        else:
            runs.append(current_run)
            current_run = [idx]
    runs.append(current_run)

    # filtrujemy tylko te runy, które mają >= min_consecutive punktów
    valid_runs = [run for run in runs if len(run) >= min_consecutive]

    if not valid_runs:
        # brak długiego ciągu -> zwracam wszystkich kandydatów
        print(
            f"Brak ciągów długości >= {min_consecutive}, "
            f"zwracam wszystkie {len(candidate_indices)} kandydatów."
        )
        baseline_indices = candidate_indices
    else:
        baseline_indices = max(valid_runs, key=len)

    excluded_pre_indices = []
    if baseline_indices:
        earliest_baseline_idx = min(baseline_indices)
        for idx in pre_indices:
            if idx < earliest_baseline_idx and abs(y[idx] - B) > tol:
                excluded_pre_indices.append(idx)

    excluded_indices = set(excluded_pre_indices)
    prev = None
    for idx, value in enumerate(y):
        if idx in excluded_indices:
            continue
        if prev is None:
            prev = value
            continue
        if value < prev - MONO_EPS:
            excluded_indices.add(idx)
        else:
            prev = max(prev, value)

    return baseline_indices, B, sorted(excluded_indices)


def plot_baseline(t, y, baseline_indices, B, title="", excluded_indices=None):
    """Rysuje wykres z zaznaczonymi punktami baseline."""
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

    if B is not None:
        plt.axhline(B, linestyle="--", label=f"baseline level ~ {B:.4f}")

    plt.xlabel("time [min]")
    plt.ylabel("OD600 (raw)")
    plt.title(title)
    plt.legend()
    plt.tight_layout()
    plt.show()


def main():
    # 1. Wczytanie pliku
    path = input(
        f"Podaj ścieżkę do pliku JSON "
        f"(ENTER = domyślnie {DEFAULT_JSON_PATH}): "
    ).strip()
    if not path:
        path = DEFAULT_JSON_PATH

    print(f"Wczytuję dane z: {path}")
    data = load_assignment(path)

    # 2. Lista samples -> wells
    sample_to_wells = list_samples_and_wells_from_mapping(data)

    print("\nDostępne próbki (sample) i ich well'e:")
    for s, wells in sample_to_wells.items():
        print(f"  {s}: {wells}")

    sample = input("\nWybierz sample (dokładna nazwa, np. SGL800): ").strip()
    if sample not in sample_to_wells:
        print(f"Nie ma takiego sample: {sample}")
        return

    wells = sample_to_wells[sample]
    print(f"Dostępne well'e dla {sample}: {wells}")
    well_choice = input("Podaj well (np. B02): ").strip()

    if well_choice not in wells:
        print(f"Well {well_choice} nie jest przypisany do sample {sample}.")
        print("Mimo to spróbuję wczytać dane dla tego wella (może mapping jest niekompletny).")

    # 3. Pobranie serii czasowej dla JEDNEGO wella
    t, y, sample_name, replicates = get_time_series_for_well(data, well_choice)

    print(f"\nWell: {well_choice}")
    print(f"Sample z datasetu: {sample_name}")
    print(f"Replikaty znalezione w tym wellu (z pola 'replicate'): {sorted(replicates)}")
    print(f"Liczba punktów czasowych: {len(t)}")

    # 4. Szukanie baseline
    baseline_indices, B, excluded_indices = find_baseline_points(t, y)
    print(f"\nZnaleziono {len(baseline_indices)} punktów baseline.")
    if B is not None:
        print(f"Poziom zero (baseline) ~ {B:.5f}")
    if baseline_indices:
        print("Czasy baseline:", [t[i] for i in baseline_indices])
        print("OD baseline:", [y[i] for i in baseline_indices])
    print(f"Punkty wykluczone z analizy: {len(excluded_indices)}")
    if excluded_indices:
        print("Czasy wykluczone:", [t[i] for i in excluded_indices])
        print("OD wykluczone:", [y[i] for i in excluded_indices])

    # 5. Wykres do wizualnej weryfikacji
    title = f"sample={sample_name}, well={well_choice}"
    plot_baseline(t, y, baseline_indices, B, title=title, excluded_indices=excluded_indices)


if __name__ == "__main__":
    main()
