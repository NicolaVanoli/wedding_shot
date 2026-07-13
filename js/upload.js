(function () {
    const activeObjectUrls = new Set();

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

    function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();

            reader.addEventListener("load", function () {
                resolve(reader.result);
            });

            reader.addEventListener("error", function () {
                reject(new Error("Impossibile leggere il file selezionato"));
            });

            reader.readAsDataURL(file);
        });
    }

    function buildUploadFormData(file, base64Data) {
        const formData = new FormData();
        formData.append("folderId", CONFIG.DRIVE_FOLDER_ID);
        formData.append("fileName", file.name);
        formData.append("mimeType", file.type || "application/octet-stream");
        formData.append("fileData", base64Data);
        return formData;
    }

    async function uploadFile(file, onProgress) {
        if (!CONFIG.APPS_SCRIPT_URL) {
            throw new Error("Configura APPS_SCRIPT_URL in js/config.js");
        }

        if (!CONFIG.DRIVE_FOLDER_ID) {
            throw new Error("Configura DRIVE_FOLDER_ID in js/config.js");
        }

        const dataUrl = await readFileAsDataUrl(file);
        const base64Data = String(dataUrl).split(",")[1];

        if (!base64Data) {
            throw new Error("Impossibile preparare il file per il caricamento");
        }

        const formData = buildUploadFormData(file, base64Data);

        // Mobile Safari/Chrome can reject Apps Script responses due to strict CORS checks.
        // Sending in no-cors mode still performs the POST and keeps the flow reliable.
        let progress = 0;
        const timerId = window.setInterval(function () {
            progress = Math.min(progress + 4, 92);
            if (typeof onProgress === "function") {
                const loaded = Math.round((file.size * progress) / 100);
                onProgress(progress, loaded, file.size);
            }
        }, 140);

        try {
            await fetch(CONFIG.APPS_SCRIPT_URL, {
                method: "POST",
                body: formData,
                mode: "no-cors",
                cache: "no-store"
            });

            window.clearInterval(timerId);
            if (typeof onProgress === "function") {
                onProgress(100, file.size, file.size);
            }

            return { success: true };
        } catch (error) {
            window.clearInterval(timerId);
            throw new Error("Errore di rete durante il caricamento");
        }
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

            this.isUploading = true;
            this.render();

            const totalBytes = this.selectedItems.reduce(function (sum, item) {
                return sum + item.file.size;
            }, 0);

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
                            message: `Caricamento file ${index + 1} di ${this.selectedItems.length}`
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
                this.onToast(error.message || "Errore durante il caricamento", "error");
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