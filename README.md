# Bacterial Growth Curves — WebApp (StackBlitz-ready)

Minimalna przeglądarkowa aplikacja (Vite + React + TypeScript), skupiona na pierwszych modułach:
- **Sample Manager** — tworzenie i zarządzanie listami próbek
- **Input Files Converter** — parsowanie plików CSV/TXT do zunifikowanego formatu (OD600)
- **Mapping Manager** — przypisywanie próbek do dołków 96-well
- **Mapping Assigner** — łączenie mappingu z danymi i eksport CSV

Pozostałe moduły są na razie **stubami**.

## Szybki start (StackBlitz)

1. Wejdź na https://stackblitz.com/ i wybierz **Upload Project** (lub **Codeflow**).
2. Prześlij ten ZIP lub wgraj cały katalog.
3. Uruchom `npm install` (StackBlitz zrobi to automatycznie) i potem `npm run dev`.
4. Podgląd powinien otworzyć się sam (port 5173).

## Założenia formatu zunifikowanego

Każdy wiersz danych (OD na razie) zawiera:
- `runId`, `plateId`, `sourceFile`
- `well` (A1..H12)
- `timeSeconds` (czas w sekundach), `timeLabel` (oryginalna etykieta czasu)
- `measurementType` (np. `"OD600"`)
- `value` (liczba)

## Aktualne parsery

- **Long CSV (Well, Time, OD)** — kolumny dokładnie: `Well, Time, OD` (czas: minuty lub `HH:MM:SS`)
- **Wide CSV (Time, A1..H12)** — kolumny: `Time` + wszystkie `A1..H12`

Łatwo dodać nowe parsery: utwórz plik w `src/modules/input_files_converter/parsers/` i dodaj go do rejestru w `src/modules/input_files_converter/index.ts`.

## Sterowanie mappingiem

- Wybór listy próbek w Sample Manager, potem w Mapping Manager utwórz nowe mapowanie z aktywnej listy.
- Kliknięcie dołka przypisuje aktualnie wybraną próbkę; ponowne kliknięcie czyści.
- Strzałki `↑/↓` zmieniają aktywną próbkę.

## Eksport

- W **Mapping Manager** można wyeksportować CSV z mapowaniem (`well,sampleName`).
- W **Mapping Assigner** można wyeksportować pełne dane z `sampleName` jako CSV.

## Licencja

MIT
