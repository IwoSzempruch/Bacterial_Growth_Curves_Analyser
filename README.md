> **Tymczasowa notka (NIE USUWAJ):** kazdy element strony musi miec opisane swoje polozenie, wyglad, styl, kazda funkcjonalnosc i relacje z innymi modulami oraz strukture plikow z ktorymi wspoldziala w mozliwie najwiekszym szczegole.

# Bacterial Growth Curves - WebApp

## Cel i zakres
Aplikacja webowa do kompleksowej obslugi eksperymentow wzrostu bakterii na plytkach 96-dolkowych. Umozliwia budowanie list probek, tworzenie i zarzadzanie mapowaniami dolkow, konwersje plikow pomiarowych, przypisywanie mapowan do datasetow oraz dalsza wizualizacje i eksport wynikow. Wszystkie dane robocze przechowywane sa lokalnie w Zustand, a kazdy modul moze importowac pliki CSV/JSON.

## Szybki start
### StackBlitz / Codeflow
1. Otworz [stackblitz.com](https://stackblitz.com/) i wybierz **Upload Project** (lub **Codeflow**).
2. Wgraj archiwum z repozytorium albo wskaz lokalny katalog.
3. Po automatycznej instalacji zaleznosci uruchom `npm run dev`.
4. Podglad aplikacji pojawi sie na porcie 5173.

### Lokalnie
```bash
npm install
npm run dev    # start dev servera
npm run build  # build produkcyjny do dist/
npm run preview
npm run test
```

## Architektura
- `src/pages/App.tsx` - zarzadzanie zakladkami (Landing, Setup, Plots Viewer, Interactive Plots, Plots Compiler, Output CSV, Data Analyser).
- `src/modules/` - odseparowane moduly funkcjonalne (Sample Manager, Mapping Creator, Convert + Assign, Plots Viewer, Interactive Plots Viewer itd.).
- `src/state/store.ts` - globalny store Zustand trzyma listy probek, mappingi, datasety, przypisania oraz stan UI.
- `src/utils/` - narzedzia pomocnicze (`colors.ts`, `csv.ts`, `export.ts`, `importers.ts`, `phase.ts`, `plate.ts`).
- `src/types.ts` - wspolne typy danych (`UnifiedDataset`, `Mapping`, `SampleList`, ...).

## Karta Setup - elementy interfejsu
### Sample List
- Pole tekstowe przyjmuje wklejone nazwy probek rozdzielane znakami nowej linii, przecinkami, srednikami lub tabulatorami; duplikaty sa usuwane.
- Pliki `.txt/.json` mozna wskazac przyciskiem lub przeciagac na textarea - zawartosc zostanie wczytana i znormalizowana.
- Lista `_Current` w store jest stale synchronizowana z zawartoscia pola, dzieki czemu jest dostepna w innych modulach.

### Mappings
- Lista mappingow pokazuje aktywny rekord (radio button), pozwala na edycje nazwy i usuwa mappingi.
- Obok licznika przypisanych dolkow znajduje sie przycisk `Download` eksportujacy pojedynczy mapping do pliku `.mapping.json`. Plik zawiera dwie sekcje: `samples` (kolejnosc z listy probek wraz z kolorem i saturacja) oraz `assignments` opisujace przypisania `well -> sample`.
- Przyciski `Import JSON` i drag&drop na panel przyjmuja wiele plikow naraz; dla kazdego z nich tworzony jest nowy mapping, a Sample List i 96-well Plate sa od razu synchronizowane z danymi z pliku.
- `New mapping (copy current)` klonuje aktywny mapping, lacznie z kolorami i przypisaniami.

### Samples to Assign
- Lista probek (waska kolumna) wyswietla kolorowe kola, liczbe przypisanych dolkow oraz slider saturacji.
- Klikniecie wiersza aktywuje probke (kolko zamienia sie w trojkat); klikniecie ikony koloru otwiera picker, a suwak aktualizuje nasycenie w przedziale 0-100.
- Przycisk `Randomize colors` przydziela nowe losowe kolory i saturacje wszystkim probkom w aktywnym mappingu.

### 96-well plate
- Siatka A1-H12 reaguje na klikniecia: pierwsze klikniecie przypisuje zaznaczona probke, kolejne usuwa przypisanie.
- Kolor tla i obramowania odpowiada kolorowi probki, a aktywny probka-well jest dodatkowo podswietlony.
- Pod siatka znajduje sie krotka instrukcja informujaca, ktora probka zostanie przypisana przy kolejnym kliknieciu.

### Import data
- Nad tabela znajduje sie strefa dropzone: mozna przeciagac wiele plikow pomiarowych (CSV, TXT, XLSX). Po wykryciu parsera pliki sa konwertowane do formatu `well,time_min,val_od600`.
- Przycisk `Import data (CSV/JSON)` obsluguje mappingi JSON, pliki assignments `.json` oraz pliki analizy; wykryty typ trafia do odpowiednich sekcji store.
- Odznaka `Busy/Ready` informuje o trwajacej konwersji.

### Converted Files
- Tabela pokazuje czas utworzenia datasetu, nazwe pliku zrodlowego, typ pomiaru, liczbe wierszy i parser.
- W kazdym wierszu znajduje sie edytowalne pole nazwy bazowej oraz przycisk `Download converted`, ktory pobiera CSV w formacie bazowym lub (jesli wybrano mapping) z kolumnami `sample` i `replicate`.
- Przycisk `Download all converted` pobiera kolejno wszystkie pliki z uzyciem aktualnych nazw bazowych.
- Przycisk `Remove` usuwa dataset ze store.

### Assign mappings to files
- Dla kazdego datasetu widoczny jest selektor mappingow (z aktywnym stanem `saved`), przycisk `Import mapping (JSON)` (pozwala wczytac plik mappingu prosto do tego datasetu) oraz pole nazwy pliku assignmentu.
- `Download mapping` pobiera pojedynczy plik `.assignment.json` (format wersja 5) zawierajacy zserializowany mapping (sekcje `samples` i `assignments` z listami `wells`) oraz dane datasetu; mapa przypisan zostaje zapisana w store.
- `Download all assignments` zapisuje wszystkie wybrane pary dataset-mapping jako osobne pliki `.assignment.json`, aktualizuje store oraz otwiera pierwszy dataset w zakladce Plots Viewer.
- Nazwy plikow do eksportu mozna edytowac przed pobraniem; sufiks i rozszerzenie dodawane sa automatycznie.

### Logs
- Panel `Logs` agreguje komunikaty ze wszystkich akcji w karcie Setup (konwersje, importy, eksporty, bledy). Najnowsze wpisy pojawiaja sie na gorze, lista jest limitowana do 200 linii.

## Pozostale moduly
- **Plots Viewer** - wykresy zbiorcze i pojedynczych probek, zarzadzanie wykluczeniami, eksporty PNG/CSV oraz pliku analizy JSON. Import zadanej analizy ustawia wykluczenia, blanki i stan interaktywny.
- **Interactive Plots Viewer** - prezentuje dane z `analysis.json` (mean, std, fazy). Posiada ten sam przycisk importu, ktory synchronizuje dane z Setup i Plots Viewer.
- **Output CSV Creator / Interactive Plots Compiler / Data Analyser** - moduly planowane; aktualnie wyswietlaja komunikaty statusowe.

## Modele danych (`src/types.ts`)
| Typ | Opis |
| --- | --- |
| `UnifiedRow` | Pojedynczy pomiar: identyfikatory (`runId`, `plateId`, `sourceFile`), kod dolka A1..H12, czas w sekundach oraz wartosc pomiaru. |
| `UnifiedDataset` | Kolekcja wierszy wraz z metadanymi (`runId`, `measurementType`, `createdAt`, `parserId`). |
| `Mapping` | Mapowanie dolkow (`assignments`), lista probek oraz opcjonalne kolory i saturacje przypisane do probek. |
| `SampleList` | Nazwana lista probek wykorzystywana w kartach Setup i Mapping Creator. |

## Konwertery wejsciowe (`src/modules/input_files_converter/parsers`)
| Parser | Zrodlo | Detekcja | Transformacja |
| --- | --- | --- | --- |
| `WellTimeLongCSV` | CSV/TXT w formacie `well,time,value` | Naglowki zawieraja `well`, `time`, `od/value` | Walidacja kodu dolka, konwersja czasu do sekund, raport ostrzezen. |
| `TimeSeriesWideCSV` | CSV `Time, A1..H12` | Sprawdzenie obecnosci kolumn skrajnych i kolumny `Time` | Zamiana na format long (`UnifiedRow`). |
| `ClariostarXlsx` | Eksport CLARIOstar `Table All Cycles` | Rozszerzenie `.xlsx` | Analiza naglowkow, interpretacja etykiet czasu, sortowanie i filtracja duplikatow. |

## Mapping Creator - uwagi implementacyjne
- Mappingi tworzone sa automatycznie na podstawie aktywnej listy `_Current`; kopiowanie i usuwanie jest natychmiastowe.
- Import JSON (przycisk lub drag&drop) przyjmuje wiele plikow i dla kazdego tworzy nowy mapping z zachowaniem kolejnosci probek z pliku; Sample List i 96-well Plate sa synchronizowane.
- Eksport przyciskiem `Download` korzysta ze wspolnej funkcji zapisujacej `.mapping.json` (sekcje `samples` i `assignments`).
- Kolory i saturacje mozna zmieniac recznie lub losowac; wartosci przechowywane sa w store wraz z mappingiem.

## Convert + Assign - przeplyw
1. Przeciaganie plikow lub wskazanie ich w polu dropzone rozpoczyna konwersje (wykrycie parsera, zapis datasetu w store). W trakcie dzialania przyciski krytyczne sa blokowane (`Busy`).
2. Tabela `Converted Files` udostepnia edycje nazw bazowych, pobieranie pojedyncze (`Download converted`) lub masowe (`Download all converted`) oraz usuwanie datasetow.
3. Panel `Assign mappings to files` pozwala wybrac mapping, nazwac plik assignmentu i pobrac go pojedynczo (`Download mapping`).
4. `Download all assignments` eksportuje wszystkie wybrane pary, zapisuje je w store oraz otwiera pierwszy dataset w zakladce Plots.
5. Panel `Assignments` na dole umozliwia hurtowe eksporty/importy plikow assignments (`.assignments.json`) i szybkie przejscie do Plots Viewer.

## Struktura repo (skrocona)
```
src/
  modules/
    convert_assign/
      ConvertAndAssign.tsx
    mapping_creator/
      MappingCreator.tsx
    samples_mapping/
      SamplesAndMapping.tsx
    ...
  pages/
    App.tsx
    LandingPage.tsx
  state/
    store.ts
  utils/
    colors.ts
    csv.ts
    export.ts
    importers.ts
    phase.ts
    plate.ts
main.tsx
styles.css
```

## Moduly w przygotowaniu
- **Output CSV Creator** - planowany zbiorczy eksport wielu datasetow do jednego pliku.
- **Interactive Plots Compiler** - planowane narzedzie do skladowania wielu wykresow w jednym layoucie.
- **Data Analyser** - planowane rozszerzone statystyki (np. mu max, punkty charakterystyczne). Aktualnie panel wyswietla komunikat o statusie.

## Testy i jakosc
- `npm run test` (Vitest, srodowisko jsdom). Brak testow jednostkowych - zalecane przy rozbudowie parserow i analizy.
- Projekt korzysta z TypeScript (strict) oraz Vite. Lintowanie odbywa sie przez `eslint`/`prettier` skonfigurowane w repozytorium.
