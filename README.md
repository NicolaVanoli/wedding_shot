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
3. Apri la cartella e imposta la condivisione su `Chiunque abbia il link` con ruolo `Visualizzatore`.
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
    var params = e && e.parameter ? e.parameter : {};
    var folderId = params.folderId;
    var fileName = params.fileName;
    var mimeType = params.mimeType || 'application/octet-stream';
    var uploadId = params.uploadId;
    var chunkData = params.chunkData;
    var chunkIndex = Number(params.chunkIndex);
    var totalChunks = Number(params.totalChunks);

    if (params.action !== 'uploadChunk' || !folderId || !fileName || !uploadId || !chunkData) {
      throw new Error('Parametri mancanti');
    }
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(uploadId) ||
        !Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks) ||
        totalChunks < 1 || totalChunks > 1024 || chunkIndex < 0 || chunkIndex >= totalChunks) {
      throw new Error('Parametri del blocco non validi');
    }

    var stagingFolder = getUploadTempFolder_();
    var completedName = uploadId + '.done';
    var completedFiles = stagingFolder.getFilesByName(completedName);
    if (completedFiles.hasNext()) {
      return uploadJson_(JSON.parse(completedFiles.next().getBlob().getDataAsString()));
    }

    var chunkName = uploadId + '-' + chunkIndex + '.part';
    var oldChunks = stagingFolder.getFilesByName(chunkName);
    while (oldChunks.hasNext()) {
      oldChunks.next().setTrashed(true);
    }
    stagingFolder.createFile(chunkName, chunkData, MimeType.PLAIN_TEXT);

    if (chunkIndex < totalChunks - 1) {
      return uploadJson_({ success: true, complete: false });
    }

    var decodedChunks = [];
    var byteLength = 0;
    for (var index = 0; index < totalChunks; index += 1) {
      var partFiles = stagingFolder.getFilesByName(uploadId + '-' + index + '.part');
      if (!partFiles.hasNext()) {
        throw new Error('Manca il blocco ' + (index + 1) + ' di ' + totalChunks);
      }
      var partBytes = Utilities.base64Decode(partFiles.next().getBlob().getDataAsString());
      decodedChunks.push(partBytes);
      byteLength += partBytes.length;
    }

    var bytes = new Array(byteLength);
    var offset = 0;
    decodedChunks.forEach(function (partBytes) {
      for (var byteIndex = 0; byteIndex < partBytes.length; byteIndex += 1) {
        bytes[offset] = partBytes[byteIndex];
        offset += 1;
      }
    });

    var blob = Utilities.newBlob(bytes, mimeType, fileName);
    var savedFile = DriveApp.getFolderById(folderId).createFile(blob);
    var result = {
      success: true,
      complete: true,
      fileId: savedFile.getId(),
      name: savedFile.getName()
    };
    stagingFolder.createFile(completedName, JSON.stringify(result), MimeType.PLAIN_TEXT);

    for (var cleanupIndex = 0; cleanupIndex < totalChunks; cleanupIndex += 1) {
      var cleanupFiles = stagingFolder.getFilesByName(uploadId + '-' + cleanupIndex + '.part');
      while (cleanupFiles.hasNext()) {
        cleanupFiles.next().setTrashed(true);
      }
    }

    return uploadJson_(result);
  } catch (error) {
    return uploadJson_({ success: false, error: error.message });
  }
}

function getUploadTempFolder_() {
  var properties = PropertiesService.getScriptProperties();
  var folderId = properties.getProperty('UPLOAD_TEMP_FOLDER_ID');
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (error) {
      properties.deleteProperty('UPLOAD_TEMP_FOLDER_ID');
    }
  }

  var folder = DriveApp.getRootFolder().createFolder('_matrimonio_upload_temp');
  properties.setProperty('UPLOAD_TEMP_FOLDER_ID', folder.getId());
  return folder;
}

function uploadJson_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
```

4. Salva il progetto.
5. Apri `Distribuisci` > `Nuova distribuzione`.
6. Seleziona `Applicazione web`.
7. Imposta:
   - `Esegui come`: `Me`
   - `Chi ha accesso`: `Chiunque`
8. Completa la distribuzione e autorizza lo script quando richiesto.
9. Se modifichi il codice Apps Script, crea una nuova versione della distribuzione Web App. Copia quindi il nuovo URL `/exec` in `js/config.js`.

Se l'upload mostra un errore HTTP `403`, la Web App non e pubblicata per l'accesso anonimo oppure l'URL configurato appartiene a una distribuzione vecchia o rimossa. La condivisione della cartella Drive non sostituisce i permessi della Web App.

Il frontend invia blocchi da 512 KB in Base64, con i campi `action`, `folderId`, `fileName`, `mimeType`, `uploadId`, `chunkIndex`, `totalChunks` e `chunkData`. Apps Script li conserva temporaneamente in Drive e ricompone il file originale al termine. I blocchi gia ricevuti possono essere ritentati senza creare file duplicati; il browser ritenta automaticamente ogni blocco fino a due volte.

Importante: dopo aver sostituito `Code.gs` con questo codice, crea una nuova versione della distribuzione Web App. Senza aggiornare Apps Script, il sito continuera a parlare il vecchio protocollo e gli upload falliranno. L'invio a blocchi riduce l'impatto delle interruzioni, ma Base64 continua ad aggiungere circa il 33% ai dati trasferiti.

## 4. Dove inserire l'URL dell'Apps Script

Apri [js/config.js](js/config.js) e compila i due valori:

```javascript
const CONFIG = {
    DRIVE_FOLDER_ID: "INCOLLA_QUI_ID_CARTELLA",
  DRIVE_RESOURCE_KEY: "",
  GALLERY_URL: "",
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

- `Vedi galleria` apre il link pubblico standard della cartella Google Drive (senza login se la cartella e condivisa come `Chiunque abbia il link`).
- `Scatta una foto` apre direttamente la fotocamera su smartphone tramite `accept="image/*"` e `capture="environment"`.
- `Carica da galleria` consente la selezione multipla di foto e video gia presenti sul dispositivo.
- Prima dell'upload viene sempre mostrata un'anteprima con possibilita di rimuovere i file.
- Durante il caricamento tutti i pulsanti vengono disabilitati e compare un overlay con spinner, barra di avanzamento e percentuale.

## Note tecniche

- Nessun login lato utente.
- Nessun database.
- Compatibile con GitHub Pages.
- Frontend facilmente configurabile modificando solo [js/config.js](js/config.js).

Suggerimento: se vuoi usare un URL specifico invece della vista automatica, imposta `GALLERY_URL` in [js/config.js](js/config.js) con il link pubblico della cartella.

Se Google chiede ancora login, copia il link completo da `Condividi > Copia link` e incollalo in `GALLERY_URL` in [js/config.js](js/config.js). Alcune cartelle richiedono anche il parametro `resourcekey` per l'accesso anonimo.