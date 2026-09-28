(function () {
    const activeObjectUrls = new Set();
    const MAX_TOTAL_UPLOAD_BYTES = 0.5 * 1024 * 1024 * 1024;
    const UPLOAD_CHUNK_BYTES = 512 * 1024;
    const MAX_CHUNK_RETRIES = 2;
    const SERVER_ACCESS_ERROR = "La Web App Google non e accessibile dal sito. Pubblica Apps Script come Chiunque e verifica che APPS_SCRIPT_URL punti all'ultima distribuzione /exec";

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return "0 B";
        }

        const units = ["B", "KB", "MB", "GB"];
        const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        const value = bytes / Math.pow(1024, exponent);
        return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
    }

    function isImage(file) {
        return file.type.startsWith("image/");
    }

    function isVideo(file) {
        return file.type.startsWith("video/");
    }

    function revokePreviewUrl(url) {
        if (!url || !activeObjectUrls.has(url)) {
            return;
        }

        URL.revokeObjectURL(url);
        activeObjectUrls.delete(url);
    }

    function readBlobAsBase64(blob) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();

            reader.addEventListener("load", function () {
                const dataUrl = String(reader.result || "");
                const separatorIndex = dataUrl.indexOf(",");
                resolve(separatorIndex === -1 ? "" : dataUrl.slice(separatorIndex + 1));
            });

            reader.addEventListener("error", function () {
                reject(new Error("Impossibile leggere il file selezionato"));
            });

            reader.readAsDataURL(blob);
        });
    }

    function buildUploadFormData(file, uploadId, chunkIndex, totalChunks, chunkData) {
        const formData = new FormData();
        formData.append("action", "uploadChunk");
        formData.append("folderId", CONFIG.DRIVE_FOLDER_ID);
        formData.append("fileName", file.name);
        formData.append("mimeType", file.type || "application/octet-stream");
        formData.append("uploadId", uploadId);
        formData.append("chunkIndex", String(chunkIndex));
        formData.append("totalChunks", String(totalChunks));
        formData.append("chunkData", chunkData);
        return formData;
    }

    function createUploadId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }

        return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
    }

    function waitBeforeRetry(attempt) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, 600 * (attempt + 1));
        });
    }

    async function sendChunk(formData) {
        let lastError;

        for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt += 1) {
            try {
                const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
                    method: "POST",
                    body: formData,
                    cache: "no-store"
                });

                if (!response.ok) {
                    const httpError = new Error(`Il server ha risposto con errore HTTP ${response.status}`);
                    httpError.retryable = response.status === 429 || response.status >= 500;
                    throw httpError;
                }

                let result;
                try {
                    result = await response.json();
                } catch (error) {
                    const confirmationError = new Error("Google non ha restituito una risposta leggibile per questo blocco");
                    confirmationError.uploadOutcomeUnknown = true;
                    throw confirmationError;
                }

                if (!result || result.success !== true) {
                    throw new Error(result && result.error
                        ? `Upload rifiutato: ${result.error}`
                        : "Il server non ha confermato la ricezione del blocco");
                }

                return result;
            } catch (error) {
                lastError = error;
                const canRetry = error instanceof TypeError || error.uploadOutcomeUnknown || error.retryable;
                if (!canRetry || attempt === MAX_CHUNK_RETRIES) {
                    break;
                }
                await waitBeforeRetry(attempt);
            }
        }

        if (lastError instanceof TypeError || (lastError && lastError.uploadOutcomeUnknown)) {
            const connectionError = new Error("Non riesco a verificare l'esito del caricamento. Controlla Drive prima di riprovare.");
            connectionError.uploadOutcomeUnknown = true;
            throw connectionError;
        }

        throw lastError || new Error("Errore durante il caricamento del blocco");
    }

    async function uploadFile(file, onProgress) {
        if (!CONFIG.APPS_SCRIPT_URL) {
            throw new Error("Configura APPS_SCRIPT_URL in js/config.js");
        }

        if (!CONFIG.DRIVE_FOLDER_ID) {
            throw new Error("Configura DRIVE_FOLDER_ID in js/config.js");
        }

        if (!file.size) {
            throw new Error("Il file selezionato e vuoto");
        }

        const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
        const uploadId = createUploadId();

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
            const start = chunkIndex * UPLOAD_CHUNK_BYTES;
            const end = Math.min(start + UPLOAD_CHUNK_BYTES, file.size);
            const chunkData = await readBlobAsBase64(file.slice(start, end));

            if (!chunkData) {
                throw new Error("Impossibile preparare un blocco del file per il caricamento");
            }

            const formData = buildUploadFormData(file, uploadId, chunkIndex, totalChunks, chunkData);
            const result = await sendChunk(formData);

            if (typeof onProgress === "function") {
                onProgress(Math.round((end / file.size) * 100), end, file.size);
            }

            if (chunkIndex === totalChunks - 1 && result.complete !== true) {
                throw new Error("Il server ha ricevuto i blocchi ma non ha confermato il salvataggio finale");
            }
        }

        return { success: true };
    }

    class UploadManager {
        constructor(options) {
            this.mode = options.mode;
            this.input = options.input;
            this.panel = options.panel;
            this.previewList = options.previewList;
            this.summary = options.summary;
            this.uploadButton = options.uploadButton;
            this.clearButton = options.clearButton;
            this.onBusyChange = options.onBusyChange;
            this.onToast = options.onToast;
            this.onVisibilityChange = options.onVisibilityChange;
            this.selectedItems = [];
            this.isUploading = false;
            this.wasVisible = false;

            this.input.addEventListener("change", this.handleInputChange.bind(this));
            this.uploadButton.addEventListener("click", this.handleUpload.bind(this));
            if (this.clearButton) {
                this.clearButton.addEventListener("click", this.clearSelection.bind(this));
            }
        }

        handleInputChange(event) {
            const files = Array.from(event.target.files || []);

            if (!files.length) {
                return;
            }

            if (this.mode === "single") {
                this.clearSelection();
                this.selectedItems = [this.createItem(files[0])];
            } else {
                const nextItems = files.map(this.createItem.bind(this));
                this.selectedItems = this.selectedItems.concat(nextItems);
            }

            this.input.value = "";
            this.render();
        }

        createItem(file) {
            const previewUrl = URL.createObjectURL(file);
            activeObjectUrls.add(previewUrl);

            return {
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                file,
                previewUrl
            };
        }

        removeItem(itemId) {
            this.selectedItems = this.selectedItems.filter(function (item) {
                if (item.id !== itemId) {
                    return true;
                }

                revokePreviewUrl(item.previewUrl);
                return false;
            });

            this.render();
        }

        clearSelection() {
            this.selectedItems.forEach(function (item) {
                revokePreviewUrl(item.previewUrl);
            });
            this.selectedItems = [];
            this.render();
        }

        render() {
            this.previewList.innerHTML = "";

            const hasFiles = this.selectedItems.length > 0;
            const becameVisible = hasFiles && !this.wasVisible;
            this.panel.classList.toggle("is-hidden", !hasFiles);
            this.uploadButton.disabled = !hasFiles || this.isUploading;
            if (this.clearButton) {
                this.clearButton.disabled = !hasFiles || this.isUploading;
            }

            if (!hasFiles) {
                this.wasVisible = false;
                this.summary.textContent = "Nessun file selezionato";
                if (typeof this.onVisibilityChange === "function") {
                    this.onVisibilityChange(false);
                }
                return;
            }

            const totalSize = this.selectedItems.reduce(function (sum, item) {
                return sum + item.file.size;
            }, 0);

            this.summary.textContent = `${this.selectedItems.length} file pronto · ${formatBytes(totalSize)}`;

            this.selectedItems.forEach(function (item) {
                const previewCard = document.createElement("article");
                previewCard.className = "preview-card";

                let mediaElement;
                if (isImage(item.file)) {
                    mediaElement = document.createElement("img");
                    mediaElement.src = item.previewUrl;
                    mediaElement.alt = `Anteprima di ${item.file.name}`;
                    mediaElement.loading = "lazy";
                    mediaElement.className = "preview-media";
                    mediaElement.tabIndex = 0;
                    mediaElement.setAttribute("role", "button");
                    mediaElement.setAttribute("aria-label", `Apri ${item.file.name} a schermo intero`);
                    mediaElement.addEventListener("click", function () {
                        if (typeof window.openPreviewLightbox === "function") {
                            window.openPreviewLightbox(item.previewUrl, item.file.name);
                        }
                    });
                    mediaElement.addEventListener("keydown", function (event) {
                        if ((event.key === "Enter" || event.key === " ") && typeof window.openPreviewLightbox === "function") {
                            event.preventDefault();
                            window.openPreviewLightbox(item.previewUrl, item.file.name);
                        }
                    });
                } else if (isVideo(item.file)) {
                    mediaElement = document.createElement("video");
                    mediaElement.src = item.previewUrl;
                    mediaElement.controls = true;
                    mediaElement.preload = "metadata";
                    mediaElement.className = "preview-media video";
                    mediaElement.setAttribute("aria-label", `Anteprima video ${item.file.name}`);
                } else {
                    mediaElement = document.createElement("div");
                    mediaElement.className = "preview-media";
                    mediaElement.textContent = "File non supportato";
                }

                const removeButton = document.createElement("button");
                removeButton.type = "button";
                removeButton.className = "remove-preview";
                removeButton.disabled = this.isUploading;
                removeButton.setAttribute("aria-label", `Rimuovi ${item.file.name}`);
                removeButton.textContent = "✕";
                removeButton.addEventListener("click", this.removeItem.bind(this, item.id));
                previewCard.appendChild(mediaElement);
                previewCard.appendChild(removeButton);
                this.previewList.appendChild(previewCard);
            }, this);

            if (becameVisible && !this.isUploading) {
                window.requestAnimationFrame(() => {
                    this.panel.scrollIntoView({ behavior: "smooth", block: "start" });
                });
            }

            if (typeof this.onVisibilityChange === "function") {
                this.onVisibilityChange(true);
            }

            this.wasVisible = true;
        }

        async handleUpload() {
            if (this.isUploading || !this.selectedItems.length) {
                return;
            }

            const totalBytes = this.selectedItems.reduce(function (sum, item) {
                return sum + item.file.size;
            }, 0);

            if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
                this.onToast("I file superano la dimensione massima consentita di 0.5 GB", "error");
                this.clearSelection();
                window.scrollTo({ top: 0, behavior: "smooth" });
                return;
            }

            this.isUploading = true;
            this.render();

            let uploadedBytes = 0;

            try {
                this.onBusyChange(true, {
                    progress: 0,
                    message: "Preparazione upload"
                });

                for (let index = 0; index < this.selectedItems.length; index += 1) {
                    const currentItem = this.selectedItems[index];
                    const bytesBeforeCurrent = uploadedBytes;

                    await uploadFile(currentItem.file, (fileProgress, loadedBytes) => {
                        const currentUploaded = bytesBeforeCurrent + loadedBytes;
                        const overallPercent = totalBytes === 0
                            ? fileProgress
                            : Math.min(100, Math.round((currentUploaded / totalBytes) * 100));

                        this.onBusyChange(true, {
                            progress: overallPercent,
                            message: `Attendi qualche secondo...`
                        });
                    });

                    uploadedBytes += currentItem.file.size;

                    this.onBusyChange(true, {
                        progress: Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)),
                        message: `Completato file ${index + 1} di ${this.selectedItems.length}`
                    });
                }

                this.onToast("Upload completato!", "success");
                this.clearSelection();
            } catch (error) {
                this.onToast(
                    error.message || "Errore durante il caricamento",
                    error.uploadOutcomeUnknown ? "warning" : "error"
                );
            } finally {
                this.isUploading = false;
                this.onBusyChange(false, {
                    progress: 0,
                    message: "Preparazione upload"
                });
                this.render();
            }
        }
    }

    window.uploadFile = uploadFile;
    window.UploadManager = UploadManager;

    window.addEventListener("beforeunload", function () {
        activeObjectUrls.forEach(function (url) {
            URL.revokeObjectURL(url);
        });
        activeObjectUrls.clear();
    });
}());