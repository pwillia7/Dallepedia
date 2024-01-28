console.log("Content script loaded");

let showingDalleImages = false;
let ongoingGenerations = 0;
const DEBUG_MODE = true; // Set to 'true' to enable detailed logging for debugging
const supabaseAuthToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjemp6a2txYWdjdXZ2cXF2d2VxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDU4Njg5MDksImV4cCI6MjAyMTQ0NDkwOX0.zGPd2QV-zUf7QrXlsfde9FTivgSbRX90t2Bt0FG2yyQ';
let lastClickedThumbnail = null; // Global variable to track the last clicked thumbnail

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
        if (ongoingGenerations > 0) {
            toggleButton.style.backgroundColor = 'yellow';
            toggleButton.style.color = 'black'; // Better contrast with yellow background
        } else {
            toggleButton.style.backgroundColor = 'lightblue';
            toggleButton.style.color = 'white'; // White text for light blue background
        }
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
        ongoingGenerations--; // Decrement count after request completion
        updateGlobalToggleButton(); // Update button color and text
        return data.dalleImageUrl;
    } catch (error) {
        console.error('Error retrieving image:', error);
        ongoingGenerations--; // Decrement even on error
        updateGlobalToggleButton();
        return null;
    }
}
async function requestImageGeneration(largerImageUrl, articleTitle, imgDescription, apiKey, width, height) {
    ongoingGenerations++; // Increment for generate-image request
    updateGlobalToggleButton();
    try {
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
    } catch (error) {
        console.error('Error generating image:', error);
        return null;
    } finally {
        ongoingGenerations--; // Decrement after generate-image request completion or failure
        updateGlobalToggleButton();
    }
}
async function processImageInBatch(images, articleTitle) {
    const batchSize = 5;
    let generateImageQueue = [];

    for (const imgElement of images) {
        const fullSizeUrl = getFullSizeImageUrl(imgElement.src);
        ongoingGenerations++; // Increment for each image being processed
        try {
            const existingDalleImageUrl = await getExistingDalleImageUrl(fullSizeUrl);
            if (existingDalleImageUrl) {
                updateImages(imgElement, existingDalleImageUrl);
            } else {
                generateImageQueue.push({ imgElement, fullSizeUrl, articleTitle });
            }
        } catch (error) {
            console.error('Error retrieving image:', error);
            if (DEBUG_MODE) console.log(`Failed retrieving existing image: ${fullSizeUrl}`);
        } finally {
            ongoingGenerations--; // Decrement after processing each image
            updateGlobalToggleButton();
        }
    }

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
    imgElement.src = showingDalleImages ? dalleImageUrl : imgElement.getAttribute('data-original-src');
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
    toggleButton.style.background = showingDalleImages ? 'lightblue' : 'yellow'; // Initial color based on DALL-E generation state
    toggleButton.style.color = 'black';
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

function observeModalChanges() {
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach(node => {
                    if (node.classList && node.classList.contains('mw-mmv-wrapper')) {
                        addToggleButtonToModal(node);
                    }
                });
            }
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

function createDalleModal(imageUrl) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.style.position = 'fixed';
    modalBackdrop.style.top = '0';
    modalBackdrop.style.left = '0';
    modalBackdrop.style.width = '100vw';
    modalBackdrop.style.height = '100vh';
    modalBackdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    modalBackdrop.style.zIndex = '2000';
    modalBackdrop.style.display = 'flex';
    modalBackdrop.style.justifyContent = 'center';
    modalBackdrop.style.alignItems = 'center';

    const modalImageContainer = document.createElement('div');
    modalImageContainer.style.maxWidth = '85vw';
    modalImageContainer.style.maxHeight = '85vh';
    modalImageContainer.style.overflow = 'auto';
    modalImageContainer.style.display = 'flex';
    modalImageContainer.style.justifyContent = 'center';
    modalImageContainer.style.alignItems = 'center';

    const image = new Image();
    image.src = imageUrl;
    image.style.maxWidth = '100vh';
    image.style.maxHeight = '100vh';
    image.style.display = 'block';
    image.style.margin = 'auto';

    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.onclick = () => modalBackdrop.remove();
    closeButton.style.marginTop = '20px';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '20px';
    closeButton.style.right = '20px';

    function closeModal() {
        modalBackdrop.remove();
        window.removeEventListener('keydown', handleKeyDown);
    }

    closeButton.onclick = closeModal;
    function handleKeyDown(e) {
        if (e.key === 'Escape') {
            closeModal();
        }
    }


    window.addEventListener('keydown', handleKeyDown);

    // Append elements to the modalBackdrop and add it to the body
    modalImageContainer.appendChild(image);
    modalBackdrop.appendChild(modalImageContainer);
    modalBackdrop.appendChild(closeButton);
    document.body.appendChild(modalBackdrop);
    
}
document.querySelectorAll('#bodyContent img').forEach(img => {
    img.addEventListener('click', () => {
        lastClickedThumbnail = img; // Update the last clicked thumbnail
    });
});

function addToggleButtonToModal(modalNode) {
    if (modalNode.querySelector('#toggleLargeImage')) return;

    const largeImage = modalNode.querySelector('img');
    if (!largeImage) return;

    if (largeImage.complete) {
        addToggle(modalNode, largeImage);
    } else {
        largeImage.onload = () => addToggle(modalNode, largeImage);
    }
}



function addToggle(modalNode, largeImage) {
    // Create the toggle button for the modal
    const toggleButton = document.createElement('button');
    toggleButton.id = 'toggleLargeImage';
    toggleButton.textContent = 'Show DALL-E Image';
    toggleButton.style.position = 'fixed';
    toggleButton.style.bottom = '340px';
    toggleButton.style.right = '10px';
    toggleButton.style.zIndex = '1901';
    toggleButton.style.display = 'block';

    toggleButton.addEventListener('click', function() {
        // Check if a thumbnail was clicked
        if (lastClickedThumbnail) {
            let dalleSrc = lastClickedThumbnail.getAttribute('data-dalle-src');
            if (dalleSrc) {
                createDalleModal(dalleSrc);
            }
        }
    });

    modalNode.appendChild(toggleButton);
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
