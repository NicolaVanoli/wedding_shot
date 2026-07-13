# Wedding Site

Sito statico per raccogliere foto e video di un matrimonio da smartphone o desktop. Il frontend usa solo HTML, CSS e JavaScript vanilla ed e progettato per essere pubblicato facilmente su GitHub Pages.

## Struttura del progetto

```text
wedding-site/
|
+-- index.html
+-- css/
|   +-- style.css
+-- js/
|   +-- app.js
|   +-- upload.js
|   +-- config.js
+-- README.md
```

## 1. Creare la cartella Google Drive

1. Apri Google Drive.
2. Crea una nuova cartella, per esempio `Foto matrimonio`.
3. Apri la cartella e condividila con le persone che devono solo visualizzare i contenuti oppure lascia il link nel sito per l'accesso diretto.
4. Il Google Apps Script dovra avere il permesso di scrivere in questa cartella.

## 2. Ottenere l'ID della cartella

1. Apri la cartella in Google Drive.
2. Guarda l'URL nel browser.
3. Copia la parte dopo `/folders/`.

Esempio:

```text
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
```

In questo caso l'ID della cartella e:

```text
1AbCdEfGhIjKlMnOpQrStUvWxYz
```

## 3. Creare il Google Apps Script

1. Vai su https://script.google.com.
2. Crea un nuovo progetto.
3. Sostituisci il contenuto del file `Code.gs` con questo esempio:

```javascript
function doPost(e) {
  try {
    var folderId = e.parameter.folderId;
    var fileName = e.parameter.fileName;
    var mimeType = e.parameter.mimeType;
    var fileData = e.parameter.fileData;

    if (!folderId || !fileName || !fileData) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Parametri mancanti' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var folder = DriveApp.getFolderById(folderId);
    var bytes = Utilities.base64Decode(fileData);
    var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName);

    var savedFile = folder.createFile(blob);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        fileId: savedFile.getId(),
        name: savedFile.getName()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

4. Salva il progetto.
5. Apri `Distribuisci` > `Nuova distribuzione`.
6. Seleziona `Applicazione web`.
7. Imposta:
   - `Esegui come`: `Me`
   - `Chi ha accesso`: `Chiunque`
8. Completa la distribuzione e autorizza lo script quando richiesto.

Nota: l'endpoint deve accettare richieste `POST` con `FormData` contenenti almeno `file` e `folderId`.

Nota importante: questo frontend invia il contenuto del file come stringa Base64 dentro `FormData`, nei campi `fileData`, `fileName`, `mimeType` e `folderId`. Questa scelta evita i problemi di parsing dei file multipart nei Web App di Google Apps Script.

## 4. Dove inserire l'URL dell'Apps Script

Apri [js/config.js](js/config.js) e compila i due valori:

```javascript
const CONFIG = {
    DRIVE_FOLDER_ID: "INCOLLA_QUI_ID_CARTELLA",
    APPS_SCRIPT_URL: "INCOLLA_QUI_URL_WEB_APP"
};
```

L'URL dell'Apps Script sara simile a questo:

```text
https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxx/exec
```

## 5. Pubblicare il sito su GitHub Pages

1. Crea un repository GitHub e carica questi file.
2. Vai nelle impostazioni del repository.
3. Apri la sezione `Pages`.
4. In `Build and deployment`, scegli:
   - `Source`: `Deploy from a branch`
   - `Branch`: `main` oppure `master`
   - Cartella: `/ (root)`
5. Salva.
6. Attendi la pubblicazione e apri l'URL fornito da GitHub Pages.

## Uso del sito

- `Vedi galleria` apre direttamente la cartella Google Drive in una nuova scheda.
- `Scatta foto o video` apre la fotocamera su smartphone tramite l'attributo `capture="environment"`.
- `Carica da galleria` consente la selezione multipla di foto e video gia presenti sul dispositivo.
- Prima dell'upload viene sempre mostrata un'anteprima con possibilita di rimuovere i file.
- Durante il caricamento tutti i pulsanti vengono disabilitati e compare un overlay con spinner, barra di avanzamento e percentuale.

## Note tecniche

- Nessun login lato utente.
- Nessun database.
- Compatibile con GitHub Pages.
- Frontend facilmente configurabile modificando solo [js/config.js](js/config.js).