# Strona setup
## Polu Mapping Creator:
### Pole "Sample List": 
Tutaj użytkownik wkleja listę nazw prób w osobnych liniach,
oddzielonyhc przecinkami, tabulatorami, średnikami lub innymi populatornymi 
sposobami lub może zaimportować lub przeciągnąć w pole tekstowe plik txt/json 
z tymi nazwami. 
Jest przycisk "Save List", który pobiera plik tekstowy z listą nazw prób.
Lista ma być tymczasowo zapamiętana, aż do zakończenia sesji
- Pole Mappings: 
Przycisk "Import": importuje plik mappingu. Można pliki zaimportować zarówno przez 
ich wybór jak i przez ich przeciągnięcie na odpowiednie pole.
Można załadować kilka plików na raz. Dane z aktualnie wybranego pliku są przekazywane
do pola "Samples to Assign" oraz pola "96-wel plate". Przycisk "New mapping (copy current)"
kopiuje mapping który jest aktualie w "Samples to Assign" i z suffixem "_copy"
dodaje go do listy mappingów i wybiera jako aktualny mapping. Nazwy mappingów
są edytowalne. Obok nazwy każdego z mappingów jest przycisk "Download"
- Pole "Samples to Assign":  Wąskie pole po lewej stronie od pola "96-well plate".
Na tym polu wyświetlają się próby wpisane aktualnie w polu "Sample List" 
lub próby z zaznaczonego aktualnie pliku mappingu (jednego z zaimportowanych)
z pola "Mappings".
Po lewej stronie od nazwy próby jest niewielkie koło w kolorze tej próby.
Kliknięcie na daną próbę zaznacza ją - wtedy koło zamienia się w trójkąt
w odpowiednim kolorze. Kliknięcie na koło/trójkąt umożliwia zmianę koloru przypisanego do próby.
Obok koła/trójkąta jest nazwa próby, a za nią w nawiasie jaśniejszą czcionką
ilość dołków przypisanych do tej próby. Po prawej stronie od nazwy próby
jest suwak przypisujacy saturację koloru tej próby. Pole to ma też przycisk
"Randomize colors" - przypisująceu nowe, losowe kolory oraz losowe saturacje
do prób w tym 
- Pole "96-well Plate": Pole obok pola "Samples to Assign",
zajmuje większość szerokości ekranu. 
Wyświetla przyciski odpowiadające dołkom od A1 do H12. Klikanie na dołki przypisują
do nich aktualnie zaznaczoą próbę z pola "Samples to Assign", wtedy przycisk
danego dołka zmienia kolor na ten przypisany do próby. Ponowne kliknięcie odznacza
dołek.
- Eksportowane i importowane pliki mappingów mają rozszerzenie ".mapping.json". Plik zawiera dwie części: tablicę `samples` (kolejność z listy prób wraz z kolorem i saturacją) oraz tablicę `assignments` opisującą przypisania `well -> sample`.
2) Pole "Import data": Na całą szerokość ekranu. Umożliwia zaimportowanie 
plików z danymi z eksperymentu poprzez ich przeciągniecie na odpowiednie pole 
lub wybranie.
- Po wyborze pliku/pliktów jest dostępny przycisk "Contunue - convert the data"
po kliknięciu, którego pliki zostaną przeparsowane
- Importowane pliki mogą mieć różne formaty, są parsowane przez różne parsery,
które będą dodawane w razie rozwoju projektu. Wykrywanie rodzaju pliku i 
przypisanie odpowiedniego parsera odbywa się automatycznie i ma również być
łatwo modyfikowalne
- Pole "Converted Files" pokazuje przeparsowane pliki. W tej liście każdy plik
ma swoje modyfikowalne pole tekstowe oraz przycisk download converted. 
Całe pole ma jeden przycisk "Download all converted". Konvertowane pliki mają mieć rozszerzenie
".data.converted.csv"
- Przeparsowane pliki mają mieć ten sam format i kolumny: 
"well,time_min,val_od600"
- Pole "Download mappings to files": Wyświetla listę plików z pola
"Converted files" oraz umożliwia przypisanie do każdego z nich jednego z mappingów.
Obok każdej pozycji jest przycisk "Download mapping" zapisujący plik z rozszerzeniem ".assignment.json" (w formacie wersja 5). Na dole pola jest przycisk "Download all assignments" zapisujacy
wszystkie pliki assignmentów. Można zmienić nazwy plikówprzed ich zapisaniem.
- Pliki ".assignment.json" mają umożliwiać kompletne odtworzenie zarówno pliku 
mappingu jak i pliku ".data.converted.csv
- Na dole panelu ma być przycisk "Analyse data", który przekazuje dane do 
kolejnej karty tj. "Plots Viewer".
3) Panel "Logs"
Pokazuje wszystkie logi programu.

