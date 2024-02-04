import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from 'https://cdn.skypack.dev/@supabase/supabase-js';
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseKey);
const stableDiffusionBaseUrl = 'http://ptkwilliams.ddns.net:6969';
let requestQueue = [];
let isProcessingQueue = false;

function normalizeAndEncodeUrl(url: string): string {
  // First, decompose Unicode characters and remove diacritics
  const decomposedUrl = url.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Then, manually replace spaces and commas as they're not covered by encodeURIComponent
  const spaceAndCommaHandledUrl = decomposedUrl.replace(/ /g, '%20').replace(/,/g, '%2C');
  // Finally, encode the rest of the URL components
  return encodeURI(spaceAndCommaHandledUrl);
}


async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  isProcessingQueue = true;
  const request = requestQueue.shift();
  try {
    const generatedImageUrl = await generateImageWithStableDiffusion(request.visionPrompt, request.originalImageUrl, request.width, request.height);
    const storedImageUrl = await saveToSupabaseStorage(generatedImageUrl, request.articleTitle);
    await insertImageRecord(request.originalImageUrl, storedImageUrl, request.articleTitle); // New line to insert the record
    return storedImageUrl;
  } catch (error) {
    console.error("Error processing queue item:", error);
    throw error;
  } finally {
    isProcessingQueue = false;
    if (requestQueue.length > 0) {
      processQueue(); // Process next item if queue is not empty
    }
  }  
}
async function fetchImageAsBase64(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  let binary = '';
  uint8Array.forEach((byte)=>{
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}
async function getExistingImage(originalImageUrl: string) {
  const encodedImageUrl = normalizeAndEncodeUrl(originalImageUrl);
  try {
    const { data, error } = await supabase
        .from('dalle_images')
        .select('dalle_image_url')
        .eq('wikipedia_image_url', encodedImageUrl);

    if (error) {
        console.error(`Error querying existing image: ${error.message}`);
        return null;
    }

    if (data.length === 0) {
      console.debug(`No existing image found for URL: ${originalImageUrl}`);
      return null;
    }

    // If multiple images are found, pick a random one
    const randomIndex = Math.floor(Math.random() * data.length);
    console.debug(`Found ${data.length} images, picking one randomly.`);
    return data[randomIndex].dalle_image_url;
  } catch (error) {
    console.error(`Error in getExistingImage: ${error.message}`);
    return null;
  }
}


async function generateVisionPrompt(imageUrl, articleTitle, imgDescription, openAIKey) {
  const visionApiUrl = 'https://api.openai.com/v1/chat/completions';
  try {
    const response = await fetch(visionApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "system",
            content: "Only output the DALLE prompt. Do not output any additional text, information, or comments. Only output the DALLE prompt."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Create a DALL-E prompt for a realistic, updated version of this Wikipedia image in the article: '${articleTitle}'. The image's description is ${imgDescription}.`
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 300
      })
    });
    const data = await response.json();
    console.log("OpenAI API response:", JSON.stringify(data));
    if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
      let content = data.choices[0].message.content;
      // Add logic to handle different types of responses
      if (content.includes("I'm sorry, but I can't provide assistance") || content.includes("not suitable for creating images")) {
        console.error("Received a non-actionable response from OpenAI API.");
        throw new Error("Non-actionable response from OpenAI API.");
      }
      return content.trim();
    } else {
      console.error("Unexpected response structure from OpenAI API.");
      throw new Error("Unexpected response structure from OpenAI API.");
    }
  } catch (error) {
    console.error("Error in generateVisionPrompt:", error);
    throw error;
  }
}
async function generateImageWithStableDiffusion(prompt, originalImageUrl, originalWidth, originalHeight) {
  const endpoint = `${stableDiffusionBaseUrl}/sdapi/v1/img2img`;
  const base64Image = await fetchImageAsBase64(originalImageUrl);
  const { width: adjustedWidth, height: adjustedHeight } = adjustImageSize(originalWidth, originalHeight);

  let payload;
  try {
    payload = {
      prompt: prompt,
      negative_prompt: "(worst quality, low quality, illustration, 3d, 2d, painting, cartoons, sketch), open mouth",
      styles: [],
      seed: -1,
      sampler_name: "DPM++ SDE Karras",
      batch_size: 1,
      n_iter: 1,
      steps: 6,
      cfg_scale: 2,
      width: adjustedWidth,
      height: adjustedHeight,
      denoising_strength: 1.0,
      processor_res: Math.min(adjustedWidth, adjustedHeight),
      init_images: [
        `data:image/jpg;base64,${base64Image}`
      ],
      alwayson_scripts: {
        controlnet: {
          args: [
            {
              control_mode: "ControlNet is more important",
              enabled: "True",
              guidance_end: 1,
              guidance_start: 0,
              processor_res: Math.min(adjustedWidth, adjustedHeight),
              image: {
                image: `data:image/jpg;base64,${base64Image}`
              },
              loopback: "False",
              low_vram: "False",
              model: "diffusers_xl_canny_full [2b69fca4]",
              module: "canny",
              pixel_perfect: "True",
              weight: 1.3,
              threshold_a: 100,
              threshold_b: 225
            }
          ]
        } 
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    // Check if response is ok
    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status}`);
      const errorBody = await response.text();
      console.error("Error response body:", errorBody);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log("Stable Diffusion API response:", JSON.stringify(data));
    return data.images[0];
  } catch (error) {
    console.error("Error in generateImageWithStableDiffusion:", error);
    console.error("Payload sent:", JSON.stringify(payload));
    throw error;
  }
}

function adjustImageSize(width: number, height: number): { width: number; height: number } {
  const numPixels = width * height;
  const minSize = 262144; // 512x512
  const maxSize = 2359296; // 1536x1536

  if (numPixels < minSize) {
    width *= 2;
    height *= 2;
  } else if (numPixels > maxSize) {
    const aspectRatio = width / height;
    height = Math.sqrt(maxSize / aspectRatio);
    width = aspectRatio * height;
  }

  return {width: Math.round(width), height: Math.round(height)};
}

async function insertImageRecord(wikipediaImageUrl, dalleImageUrl, articleTitle) {
  // Normalize and encode URL before inserting into the database
  const encodedImageUrl = normalizeAndEncodeUrl(wikipediaImageUrl);
  try {
      const { data, error } = await supabase
          .from('dalle_images')
          .insert([
              { wikipedia_image_url: encodedImageUrl, dalle_image_url: dalleImageUrl, article_title: articleTitle }
          ]);
      if (error) {
          throw error;
      }
      console.log("Image record successfully inserted:", data);
      return data;
  } catch (error) {
      console.error("Error inserting image record into database:", error);
      throw error;
  }
}

async function saveToSupabaseStorage(base64Image, articleTitle) {
  try {
    // Convert base64 string to a Blob
    const response = await fetch(`data:image/jpeg;base64,${base64Image}`);
    const blob = await response.blob();
    articleTitle = articleTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const filename = `${articleTitle}/${Date.now()}-${Math.random().toString(36).substring(2, 15)}.jpg`;
    const { data, error } = await supabase.storage.from('dalle_images_bucket').upload(filename, blob);
    if (error) {
      console.error("Error uploading file to Supabase Storage:", error.message);
      throw error;
    }
    console.log("File successfully uploaded to Supabase Storage:", data);
    return `${supabaseUrl}/storage/v1/object/public/dalle_images_bucket/${filename}`;
  } catch (error) {
    console.error("Error in saveToSupabaseStorage:", error);
    throw error;
  }
}
function setCORSHeaders(headers) {
  headers.set(  'Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
}
serve(async (req)=>{
  const headers = new Headers();
  setCORSHeaders(headers);
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers
      });
    }
    if (req.method === 'GET' && req.url.includes('/get-image')) {
      const urlParams = new URL(req.url).searchParams;
      const originalImageUrl = urlParams.get('originalImageUrl');
      if (originalImageUrl) {
        const existingImageUrl = await getExistingImage(originalImageUrl);
        return new Response(JSON.stringify({
          dalleImageUrl: existingImageUrl
        }), {
          status: 200,
          headers
        });
      }
      return new Response('Invalid request', {
        status: 400,
        headers
      });
    }
    if (req.method === 'POST' && req.url.includes('/dallepedia-server/generate-image')) {
      try {
        const { originalImageUrl, articleTitle, imgDescription, openAIKey, width, height } = await req.json();
        const visionPrompt = await generateVisionPrompt(originalImageUrl, articleTitle, imgDescription, openAIKey);
        requestQueue.push({
          visionPrompt,
          originalImageUrl,
          width,
          height,
          articleTitle
        });
        const storedImageUrl = await processQueue();
        return new Response(JSON.stringify({
          dalleImageUrl: storedImageUrl
        }), {
          status: 200,
          headers
        });
      } catch (error) {
        console.error("Error in POST request handling:", error);
        return new Response(JSON.stringify({
          error: 'Error generating image'
        }), {
          status: 500,
          headers
        });
      }
    }
    return new Response('Not Found', {
      status: 404,
      headers
    });
  } catch (error) {
    console.error("Server Error:", error);
    // Ensure CORS headers are set even in error responses
    return new Response(JSON.stringify({
      error: 'Internal Server Error'
    }), {
      status: 500,
      headers
    });
  }
}, {
  port: 8080
});
