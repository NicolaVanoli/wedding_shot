(function () {
    const openGalleryButton = document.getElementById("open-gallery-btn");
    const captureButton = document.getElementById("capture-btn");
    const selectButton = document.getElementById("select-btn");
    const overlay = document.getElementById("upload-overlay");
    const overlayProgressBar = document.getElementById("overlay-progress-bar");
    const overlayProgressText = document.getElementById("overlay-progress-text");
    const overlayStatusText = document.getElementById("overlay-status-text");
    const toast = document.getElementById("toast");
    const heroCard = document.querySelector(".hero");
    const lightbox = document.getElementById("preview-lightbox");
    const lightboxImage = document.getElementById("lightbox-image");
    const lightboxCloseButton = document.getElementById("lightbox-close-btn");

    let toastTimer = null;
    let captureHasSelection = false;
    let selectHasSelection = false;

    function refreshHeroVisibility() {
        const hasActiveSelection = captureHasSelection || selectHasSelection;
        if (heroCard) {
            heroCard.classList.toggle("is-hidden", hasActiveSelection);
        }
        document.body.classList.toggle("home-centered", !hasActiveSelection);
    }

    function closePreviewLightbox() {
        lightbox.classList.add("is-hidden");
        lightbox.setAttribute("aria-hidden", "true");
        lightboxImage.removeAttribute("src");
        lightboxImage.alt = "Anteprima immagine a schermo intero";
        document.body.classList.remove("lightbox-open");
    }

    function openPreviewLightbox(src, fileName) {
        if (!src) {
            return;
        }

        lightboxImage.src = src;
        lightboxImage.alt = `Anteprima a schermo intero di ${fileName || "immagine"}`;
        lightbox.classList.remove("is-hidden");
        lightbox.setAttribute("aria-hidden", "false");
        document.body.classList.add("lightbox-open");
    }

    window.openPreviewLightbox = openPreviewLightbox;

    function showToast(message, type) {
        toast.textContent = message;
        toast.classList.add("is-visible");
        toast.style.background = type === "error"
            ? "rgba(140, 52, 52, 0.96)"
            : "rgba(64, 54, 46, 0.94)";

        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
            toast.classList.remove("is-visible");
        }, 2600);
    }

    function setBusyState(isBusy, details) {
        document.body.classList.toggle("is-busy", isBusy);
        overlay.classList.toggle("is-hidden", !isBusy);
        overlay.setAttribute("aria-hidden", String(!isBusy));

        Array.from(document.querySelectorAll("button")).forEach(function (button) {
            button.disabled = isBusy;
        });

        if (!details) {
            return;
        }

        overlayProgressBar.style.width = `${details.progress || 0}%`;
        overlayProgressText.textContent = `${details.progress || 0}%`;
        overlayStatusText.textContent = details.message || "Preparazione upload";
    }

    function openDriveGallery() {
        const customGalleryUrl = (CONFIG.GALLERY_URL || "").trim();
        const resourceKey = (CONFIG.DRIVE_RESOURCE_KEY || "").trim();

        if (customGalleryUrl) {
            window.open(customGalleryUrl, "_blank", "noopener");
            return;
        }

        if (!CONFIG.DRIVE_FOLDER_ID) {
            showToast("Inserisci DRIVE_FOLDER_ID in js/config.js", "error");
            return;
        }

        // Some shared folders require resourcekey in the URL to open without account context.
        const baseUrl = `https://drive.google.com/drive/folders/${encodeURIComponent(CONFIG.DRIVE_FOLDER_ID)}`;
        const publicGalleryUrl = resourceKey
            ? `${baseUrl}?usp=sharing&resourcekey=${encodeURIComponent(resourceKey)}`
            : `${baseUrl}?usp=sharing`;
        window.open(publicGalleryUrl, "_blank", "noopener");
    }

    const captureManager = new UploadManager({
        mode: "single",
        input: document.getElementById("capture-input"),
        panel: document.getElementById("capture-panel"),
        previewList: document.getElementById("capture-preview-list"),
        summary: document.getElementById("capture-summary"),
        uploadButton: document.getElementById("capture-upload-btn"),
        onBusyChange: setBusyState,
        onToast: showToast,
        onVisibilityChange: function (isVisible) {
            captureHasSelection = isVisible;
            refreshHeroVisibility();
        }
    });

    const selectManager = new UploadManager({
        mode: "multiple",
        input: document.getElementById("select-input"),
        panel: document.getElementById("select-panel"),
        previewList: document.getElementById("select-preview-list"),
        summary: document.getElementById("select-summary"),
        uploadButton: document.getElementById("select-upload-btn"),
        onBusyChange: setBusyState,
        onToast: showToast,
        onVisibilityChange: function (isVisible) {
            selectHasSelection = isVisible;
            refreshHeroVisibility();
        }
    });

    openGalleryButton.addEventListener("click", openDriveGallery);
    captureButton.addEventListener("click", function () {
        document.getElementById("capture-input").click();
    });
    selectButton.addEventListener("click", function () {
        document.getElementById("select-input").click();
    });

    lightboxCloseButton.addEventListener("click", closePreviewLightbox);
    lightbox.addEventListener("click", function (event) {
        if (event.target === lightbox) {
            closePreviewLightbox();
        }
    });

    window.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !lightbox.classList.contains("is-hidden")) {
            closePreviewLightbox();
        }
    });

    window.addEventListener("pageshow", function () {
        setBusyState(false, {
            progress: 0,
            message: "Preparazione upload"
        });
        captureManager.render();
        selectManager.render();
        refreshHeroVisibility();
    });
}());