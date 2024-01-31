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
        // Update button color only when all generations are complete
        if (ongoingGenerations === 0) {
            toggleButton.style.backgroundColor = 'lightblue';
            toggleButton.style.color = 'white'; // White text for light blue background
        } else {
            toggleButton.style.backgroundColor = 'yellow';
            toggleButton.style.color = 'black'; // Better contrast with yellow background
        }
    }
}


async function getExistingDalleImageUrl(originalSrc) {
    try {
        const response = await fetch(`https://vczjzkkqagcuvvqqvweq.supabase.co/functions/v1/dallepedia-server/get-image?originalImageUrl=${encodeURIComponent(originalSrc)}`, {
            headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseAuthToken}`}
        });
        const data = await response.json();
        return data.dalleImageUrl;
    } catch (error) {
        console.error('Error retrieving image:', error);
        return null;
    } finally {
        updateGlobalToggleButton();
    }
}


async function requestImageGeneration(largerImageUrl, articleTitle, imgDescription, apiKey, width, height) {
    updateGlobalToggleButton();
    try {
        const response = await fetch('https://vczjzkkqagcuvvqqvweq.supabase.co/functions/v1/dallepedia-server/generate-image', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'apikey': supabaseAuthToken, 'Authorization': `Bearer ${supabaseAuthToken}`},
            body: JSON.stringify({originalImageUrl: largerImageUrl, articleTitle, imgDescription, openAIKey: apiKey, width, height})
        });
        const data = await response.json();
        return data.dalleImageUrl;
    } catch (error) {
        console.error('Error generating image:', error);
        return null;
    } finally {
        updateGlobalToggleButton();
    }
}

async function processImageInBatch(images, articleTitle) {
    const batchSize = 2;
    let generateImageQueue = [];

    for (const imgElement of images) {
        const fullSizeUrl = getFullSizeImageUrl(imgElement.src);
        const existingDalleImageUrl = await getExistingDalleImageUrl(fullSizeUrl);

        if (!existingDalleImageUrl) {
            generateImageQueue.push({ imgElement, fullSizeUrl, articleTitle });
            ongoingGenerations++; // Increment only for new image generation requests
        } else {
            updateImages(imgElement, existingDalleImageUrl);
        }
    }

    updateGlobalToggleButton(); // Update the toggle button after setting the initial count

    while (generateImageQueue.length > 0) {
        const currentBatch = generateImageQueue.splice(0, batchSize);
        await processBatch(currentBatch);
    }
}


async function processBatch(batch) {
    const apiKey = await getApiKey();
    const generationPromises = batch.map(({ imgElement, fullSizeUrl, articleTitle }) => processSingleImage(imgElement, fullSizeUrl, articleTitle, apiKey));
    await Promise.all(generationPromises);
}

async function processSingleImage(imgElement, fullSizeUrl, articleTitle, apiKey) {
    const loader = createLoadingIndicator();
    imgElement.parentNode.appendChild(loader);

    try {
        updateImageUrl(imgElement); // Update the image URL
        await imgElement.decode(); // Ensure the image is loaded to get natural dimensions

        let width = imgElement.naturalWidth;
        let height = imgElement.naturalHeight;
        const maxDimension = 1024;

        // Adjust dimensions if either is greater than 1300px
        if (width > 1300 || height > 1300) {
            if (width > height) {
                // Maintain aspect ratio
                height = Math.round((maxDimension / width) * height);
                width = maxDimension;
            } else {
                width = Math.round((maxDimension / height) * width);
                height = maxDimension;
            }
        }

        const imgDescription = getImageDescription(imgElement);
        const dalleImageUrl = await requestImageGeneration(imgElement.src, articleTitle, imgDescription, apiKey, width, height);

        if (dalleImageUrl) {
            updateImages(imgElement, dalleImageUrl);
        }
    } catch (error) {
        console.error('Error processing image:', error);
    } finally {
        loader.remove();
        ongoingGenerations--;
        updateGlobalToggleButton();
    }
}

function updateImageUrl(imgElement) {
    const newSrc = imgElement.src.replace('/thumb', '').split('/').slice(0, -1).join('/');
    imgElement.src = newSrc;
    imgElement.srcset = '';
}

function setupBeforeUnloadWarning() {
    window.addEventListener('beforeunload', function (e) {
        // Check if there are ongoing generations
        if (ongoingGenerations > 0) {
            // Cancel the event
            e.preventDefault(); 
            // Chrome requires returnValue to be set
            e.returnValue = '';
        }
    });
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
    img.addEventListener('click', () => lastClickedThumbnail = img);
});

function addToggleButtonToModal(modalNode) {
    const largeImage = modalNode.querySelector('img');
    if (largeImage && !modalNode.querySelector('#toggleLargeImage')) {
        const toggleButton = document.createElement('button');
        toggleButton.id = 'toggleLargeImage';
        toggleButton.textContent = 'Show DALL-E Image';
        toggleButton.style.position = 'fixed';
        toggleButton.style.bottom = '340px';
        toggleButton.style.right = '10px';
        toggleButton.style.zIndex = '1901';
        toggleButton.style.display = 'block';
        toggleButton.addEventListener('click', () => {
            if (lastClickedThumbnail) {
                const dalleSrc = lastClickedThumbnail.getAttribute('data-dalle-src');
                if (dalleSrc) {
                    createDalleModal(dalleSrc);
                }
            }
        });
        modalNode.appendChild(toggleButton);
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
            attachGlobalToggleButton();
            observeModalChanges();
            setupBeforeUnloadWarning();
            const articleTitle = document.querySelector('h1').innerText;
            const images = document.querySelectorAll('#bodyContent img:not([style*="display:none"]):not([style*="visibility:hidden"])');
            const eligibleImages = Array.from(images).filter(img => img.offsetWidth > 50 && img.offsetHeight > 50);

            if (eligibleImages.length > 0) {
                await processImageInBatch(eligibleImages, articleTitle);
            }
        }
    });
}
init();
