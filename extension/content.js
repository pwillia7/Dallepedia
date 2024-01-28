console.log("Content script loaded");

let showingDalleImages = false;
let ongoingGenerations = 0;
const DEBUG_MODE = true; // Set to 'true' to enable detailed logging for debugging
const supabaseAuthToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjemp6a2txYWdjdXZ2cXF2d2VxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDU4Njg5MDksImV4cCI6MjAyMTQ0NDkwOX0.zGPd2QV-zUf7QrXlsfde9FTivgSbRX90t2Bt0FG2yyQ';

function isDalleEnabled(callback) {
    chrome.storage.local.get('isExtensionEnabled', function(data) {
        callback(data.isExtensionEnabled !== false);
    });
}

function getImageDescription(imgElement) {
    const figureParent = imgElement.closest('figure');
    if (figureParent) {
        const figcaption = figureParent.querySelector('figcaption');
        return figcaption ? figcaption.textContent.trim() : '';
    }

    const galleryItem = imgElement.closest('li.gallerybox');
    if (galleryItem) {
        const galleryText = galleryItem.querySelector('.gallerytext');
        return galleryText ? galleryText.textContent.trim() : '';
    }

    return '';
}

function getFullSizeImageUrl(thumbnailUrl) {
    return thumbnailUrl.replace('/thumb', '').split('/').slice(0, -1).join('/');
}

function createLoadingIndicator() {
    const loader = document.createElement('div');
    loader.style.border = '2px solid yellow'; // Initial border color for loading
    loader.style.borderRadius = '5px';
    return loader;
}

function updateGlobalToggleButton() {
    const toggleButton = document.getElementById('toggleAllImagesButton');
    if (toggleButton) {
        toggleButton.textContent = ongoingGenerations > 0 ? 'Loading...' : (showingDalleImages ? 'Show Original' : 'Show DALL-E');
    }
}

async function getExistingDalleImageUrl(originalSrc) {
    try {
        const response = await fetch(`https://vczjzkkqagcuvvqqvweq.supabase.co/functions/v1/dallepedia-server/get-image?originalImageUrl=${encodeURIComponent(originalSrc)}`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseAuthToken}`
            }
        });
        const data = await response.json();
        return data.dalleImageUrl;
    } catch (error) {
        console.error('Error retrieving image:', error);
        return null;
    }
}

async function requestImageGeneration(largerImageUrl, articleTitle, imgDescription, apiKey, width, height) {
    const response = await fetch('https://vczjzkkqagcuvvqqvweq.supabase.co/functions/v1/dallepedia-server/generate-image', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseAuthToken,
            'Authorization': `Bearer ${supabaseAuthToken}`
        },
        body: JSON.stringify({
            originalImageUrl: largerImageUrl,
            articleTitle: articleTitle,
            imgDescription: imgDescription,
            openAIKey: apiKey,
            width: width,
            height: height
        })
    });
    const data = await response.json();
    return data.dalleImageUrl;
}

async function processImageInBatch(images, articleTitle) {
    const batchSize = 5;
    let generateImageQueue = [];

    // First, attempt to retrieve existing images for all eligible images
    for (const imgElement of images) {
        const fullSizeUrl = getFullSizeImageUrl(imgElement.src);
        try {
            const existingDalleImageUrl = await getExistingDalleImageUrl(fullSizeUrl);
            if (existingDalleImageUrl) {
                updateImages(imgElement, existingDalleImageUrl);
            } else {
                // Queue for generation if no existing image found
                generateImageQueue.push({ imgElement, fullSizeUrl, articleTitle });
            }
        } catch (error) {
            console.error('Error retrieving image:', error);
            if (DEBUG_MODE) console.log(`Failed retrieving existing image: ${fullSizeUrl}`);
        }
    }

    // Process images in queue in batches
    while (generateImageQueue.length > 0) {
        const currentBatch = generateImageQueue.splice(0, batchSize);
        if (DEBUG_MODE) console.log(`Processing batch: ${currentBatch.map(i => i.fullSizeUrl)}`);
        await processBatch(currentBatch);
    }
}


async function processBatch(batch) {
    const apiKey = await getApiKey();
    for (const { imgElement, fullSizeUrl, articleTitle } of batch) {
        const loader = createLoadingIndicator();
        imgElement.parentNode.appendChild(loader);
        ongoingGenerations++;
        updateGlobalToggleButton();

        try {
            const imgDescription = getImageDescription(imgElement);
            const image = new Image();
            image.onload = async () => {
                const width = image.naturalWidth;
                const height = image.naturalHeight;
                const dalleImageUrl = await requestImageGeneration(fullSizeUrl, articleTitle, imgDescription, apiKey, width, height);
                updateImages(imgElement, dalleImageUrl);
                loader.remove();
            };
            image.onerror = () => {
                console.error('Error loading full-size image.');
                loader.remove();
            };
            image.src = fullSizeUrl;
        } catch (error) {
            console.error('Error processing image:', error);
            loader.remove();
        } finally {
            ongoingGenerations--;
            updateGlobalToggleButton();
        }
    }
}

function updateImages(imgElement, dalleImageUrl) {
    if (!imgElement.getAttribute('data-original-src')) {
        imgElement.setAttribute('data-original-src', imgElement.src);
    }
    imgElement.src = showingDalleImages ? dalleImageUrl : imgElement.src;
    imgElement.setAttribute('data-dalle-src', dalleImageUrl);
    imgElement.classList.add('toggleable-image');
    imgElement.style.border = '2px solid lightblue';
    imgElement.removeAttribute('srcset');
}

function toggleAllImages() {
    const images = document.querySelectorAll('#bodyContent img.toggleable-image');
    images.forEach(imgElement => {
        const originalSrc = imgElement.getAttribute('data-original-src');
        const dalleSrc = imgElement.getAttribute('data-dalle-src');
        imgElement.src = showingDalleImages ? originalSrc : dalleSrc;
    });
    showingDalleImages = !showingDalleImages;
    updateGlobalToggleButton();
}

async function getApiKey() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get('dalleApiKey', (data) => {
            if (data.dalleApiKey) {
                resolve(data.dalleApiKey);
            } else {
                reject('No API key found');
            }
        });
    });
}

function attachGlobalToggleButton() {
    let toggleButton = document.createElement('button');
    toggleButton.id = 'toggleAllImagesButton';
    toggleButton.textContent = 'Show DALL-E';
    toggleButton.style.padding = '5px 10px';
    toggleButton.style.fontSize = '12px';
    toggleButton.style.background = 'rgba(0, 0, 0, 0.5)';
    toggleButton.style.color = 'white';
    toggleButton.style.border = 'none';
    toggleButton.style.borderRadius = '5px';
    toggleButton.style.cursor = 'pointer';
    toggleButton.style.position = 'fixed';
    toggleButton.style.zIndex = '1000';
    toggleButton.style.right = '10px';
    toggleButton.style.top = '10px';

    toggleButton.onclick = toggleAllImages;
    document.body.insertBefore(toggleButton, document.body.firstChild);
}

// Function to observe changes in the DOM for the modal
function observeModalChanges() {
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach(node => {
                    if (node.classList && node.classList.contains('mw-mmv-image')) {
                        addToggleButtonToModal(node);
                    }
                });
            }
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// Function to add a toggle button to the modal
function addToggleButtonToModal(modalNode) {
    if (modalNode.querySelector('#toggleLargeImage')) return;

    const largeImage = modalNode.querySelector('img');
    if (!largeImage) return;

    const toggleButton = document.createElement('button');
    toggleButton.id = 'toggleLargeImage';
    toggleButton.textContent = 'Show Original';
    toggleButton.style.position = 'absolute';
    toggleButton.style.bottom = '10px';
    toggleButton.style.right = '10px';
    toggleButton.style.zIndex = '1001';

    toggleButton.addEventListener('click', function() {
        const dalleSrc = largeImage.getAttribute('data-dalle-src');
        const originalSrc = largeImage.getAttribute('data-original-src');

        if (largeImage.src === dalleSrc) {
            largeImage.src = originalSrc;
            this.textContent = 'Show DALL-E Image';
        } else {
            largeImage.src = dalleSrc;
            this.textContent = 'Show Original';
        }

        if (DEBUG_MODE) console.log(`Toggled large image to ${largeImage.src}`);
    });

    modalNode.appendChild(toggleButton);
    if (DEBUG_MODE) console.log('Toggle button added to modal.');
}



function init() {
    isDalleEnabled(async (enabled) => {
        if (enabled) {
            if (DEBUG_MODE) console.log('DALL-E Image Extension enabled.');
            attachGlobalToggleButton();
            observeModalChanges();
            const articleTitle = document.querySelector('h1').innerText;
            const images = document.querySelectorAll('#bodyContent img:not([style*="display:none"]):not([style*="visibility:hidden"])');
            const eligibleImages = Array.from(images).filter(img => img.offsetWidth > 50 && img.offsetHeight > 50);
            if (eligibleImages.length > 0) {
                if (DEBUG_MODE) console.log(`Processing ${eligibleImages.length} eligible images`);
                await processImageInBatch(eligibleImages, articleTitle);
            }
        } else {
            if (DEBUG_MODE) console.log('DALL-E Image Extension disabled.');
        }
    });
}


init();
