console.log("WikipixAI initialized...1");

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
async function getWikiImageMetadata(fileName) {
    const endpoint = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&titles=File:${encodeURIComponent(fileName)}&iiprop=timestamp|url|size|mime|mediatype|extmetadata&iiextmetadatafilter=DateTime|DateTimeOriginal|ObjectName|ImageDescription|License|LicenseShortName|UsageTerms|LicenseUrl|Credit|Artist|AuthorCount|GPSLatitude|GPSLongitude|Permission|Attribution|AttributionRequired|NonFree|Restrictions|DeletionReason&iiextmetadatalanguage=en&uselang=content&smaxage=300&maxage=300`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Failed to fetch image metadata');
    const data = await response.json();
    const imageInfo = data.query.pages[0].imageinfo[0];
    const imageDescription = imageInfo.extmetadata.ImageDescription && imageInfo.extmetadata.ImageDescription.value ? imageInfo.extmetadata.ImageDescription.value : 'No description available.';
    // Include image description in the returned metadata
    return { ...imageInfo, description: imageDescription };
}
function getImageFileName(url) {
    // Match only the portion of the URL up to and including the first file extension
    const pattern = /\/([^\/]+?\.(jpg|jpeg|png|gif|svg))/i;
    const matches = url.match(pattern);
    if (matches && matches.length > 1) {
        // DecodeURIComponent is used to ensure any encoded characters are correctly interpreted
        return decodeURIComponent(matches[1]);
    }
    return null; // Return null if a valid file name couldn't be extracted
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


async function getExistingDalleImageUrl(fullImageUrl) {
    try {
        const response = await fetch(`https://vczjzkkqagcuvvqqvweq.supabase.co/functions/v1/dallepedia-server/get-image?originalImageUrl=${encodeURIComponent(fullImageUrl)}`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseAuthToken}`
            }
        });
        const data = await response.json();
        return data.dalleImageUrl;
    } catch (error) {
        console.error('Error retrieving existing DALL-E image:', error);
        return null;
    } finally {
        updateGlobalToggleButton();
    }
}


// This function now properly queues images for processing based on metadata from Wikipedia
async function processImageInBatch(images, articleTitle) {
    let generateImageQueue = [];

    for (const imgElement of images) {
        const fileName = getImageFileName(imgElement.src);
        if (!fileName) continue;

        try {
            const metadata = await getWikiImageMetadata(fileName);
            if (metadata) {
                const { url: fullSizeUrl, description, width, height } = metadata;
                const existingDalleImageUrl = await getExistingDalleImageUrl(fullSizeUrl);
                if (!existingDalleImageUrl) {
                    generateImageQueue.push({ imgElement, fullSizeUrl, articleTitle, description, width, height });
                    ongoingGenerations++;
                    updateGlobalToggleButton();
                } else {
                    updateImages(imgElement, existingDalleImageUrl);
                }
            }
        } catch (error) {
            console.error('Error processing image metadata:', error);
        }
    }

    while (generateImageQueue.length > 0) {
        const currentBatch = generateImageQueue.splice(0, 2);
        await processBatch(currentBatch);
    }
}
async function processBatch(batch) {
    const apiKey = await getApiKey();
    const generationPromises = batch.map(item => 
        processSingleImage(item.imgElement, item.fullSizeUrl, item.articleTitle, apiKey, item.description, item.width, item.height)
    );
    await Promise.all(generationPromises);
}

// Adjusted to use metadata for image processing
// Adjusted to use metadata for image processing, including width and height
async function processSingleImage(imgElement, fullSizeUrl, articleTitle, apiKey, description, width, height) {
    const loader = createLoadingIndicator();
    imgElement.parentNode.insertBefore(loader, imgElement);

    try {
        const payload = {
            originalImageUrl: fullSizeUrl,
            articleTitle: articleTitle,
            imgDescription: description.replace(/<(.|\n)*?>/g, ''),
            openAIKey: apiKey,
            width: width, // Ensure width is included
            height: height // Ensure height is included
        };

        const response = await fetch('https://vczjzkkqagcuvvqqvweq.supabase.co/functions/v1/dallepedia-server/generate-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseAuthToken}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.dalleImageUrl) {
            updateImages(imgElement, data.dalleImageUrl);
        }
    } catch (error) {
        console.error('Error generating image:', error);
    } finally {
        loader.remove();
        ongoingGenerations--;
        updateGlobalToggleButton();
    }
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
