import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from 'https://cdn.skypack.dev/@supabase/supabase-js';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseKey);
const stableDiffusionBaseUrl = 'http://ptkwilliams.ddns.net:6969';

async function fetchImageAsBase64(url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    uint8Array.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

async function getExistingImage(originalImageUrl) {
    try {
        const { data, error } = await supabase
            .from('dalle_images')
            .select('dalle_image_url')
            .eq('wikipedia_image_url', originalImageUrl)
            .single();

        if (error) {
            throw error;
        }

        return data ? data.dalle_image_url : null;
    } catch (error) {
        console.error("Error in getExistingImage:", error);
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
                        content: "Only output the DALLE prompt. Do not output any additional text, information, comments, style or other output. Only output the DALLE prompt. Output: [DALLE PROMPT]"
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: `Create a DALL-E prompt for an accurate, beautiful, realistic and more modern version of this image: '${imgDescription}' in the Wikipedia article titled: ${articleTitle}. Include details about the medium, lighting and other details based on what you see in the image and you best guess to improve it. The following is an example addition to the prompt for a photograph, but it could be other mediums too. Use your best judgement to build the best prompt you can i.e. '3 point lighting, flash with softbox, by Annie Leibovitz, 80mm, hasselblad, f2.8`
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

async function generateImageWithStableDiffusion(prompt, originalImageUrl, width, height) {
    const endpoint = `${stableDiffusionBaseUrl}/sdapi/v1/img2img`;
    const base64Image = await fetchImageAsBase64(originalImageUrl);

    let payload;

    try {
        payload = {
            prompt: prompt ,
            negative_prompt: "worst quality, normal quality, low quality, low res, blurry, text, watermark, logo, banner, extra digits, cropped, jpeg artifacts, signature, username, error, sketch ,duplicate, ugly, monochrome, horror, geometry, mutation, disgusting, bad anatomy, bad hands, three hands, three legs, bad arms, missing legs, missing arms, poorly drawn face, bad face, fused face, cloned face, worst face, three crus, extra crus, fused crus, worst feet, three feet, fused feet, fused thigh, three thigh, fused thigh, extra thigh, worst thigh, missing fingers, extra fingers, ugly fingers, long fingers, horn, extra eyes, huge eyes, 2girl, amputation, disconnected limbs, cartoon, cg, 3d, unreal, animate",
            styles: [],
            seed: -1,
            sampler_name: "DPM++ 3M SDE Karras",
            batch_size: 1,
            n_iter: 1,
            steps: 30,
            cfg_scale: 7,
            width: width,
            height: height,
            denoising_strength: 0.6,
            init_images: [`data:image/png;base64,${base64Image}`]
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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


async function saveToSupabaseStorage(base64Image, articleTitle) {
    try {
        // Convert base64 string to a Blob
        const response = await fetch(`data:image/jpeg;base64,${base64Image}`);
        const blob = await response.blob();
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
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');
    headers.set('Access-Control-Allow-Credentials', 'true');
}

serve(async (req) => {
    const headers = new Headers();
    setCORSHeaders(headers);

    try {
        if (req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }
        if (req.method === 'GET' && req.url.includes('/get-image')) {
            const urlParams = new URL(req.url).searchParams;
            const originalImageUrl = urlParams.get('originalImageUrl');
            
            if (originalImageUrl) {
                const existingImageUrl = await getExistingImage(originalImageUrl);
                return new Response(JSON.stringify({ dalleImageUrl: existingImageUrl }), { status: 200, headers });
            }
    
            return new Response('Invalid request', { status: 400, headers });
        }
    
    
        if (req.method === 'POST' && req.url.includes('/dallepedia-server/generate-image')) {
            try {
                const { originalImageUrl, articleTitle, imgDescription, openAIKey, width, height } = await req.json();
                const visionPrompt = await generateVisionPrompt(originalImageUrl, articleTitle, imgDescription, openAIKey);
                const generatedImageUrl = await generateImageWithStableDiffusion(visionPrompt, originalImageUrl, width, height);
                const storedImageUrl = await saveToSupabaseStorage(generatedImageUrl, articleTitle);
    
                const insertResponse = await supabase
                    .from('dalle_images')
                    .insert([{ wikipedia_image_url: originalImageUrl, dalle_image_url: storedImageUrl, article_title: articleTitle, image_description: imgDescription }]);
                
                console.log("Supabase insert response:", JSON.stringify(insertResponse));
                if (insertResponse.error) throw insertResponse.error;
    
                return new Response(JSON.stringify({ dalleImageUrl: storedImageUrl }), { status: 200, headers });
            } catch (error) {
                console.error("Error in POST request handling:", error);
                return new Response(JSON.stringify({ error: 'Error generating image' }), { status: 500, headers });
            }
        }
        return new Response('Not Found', { status: 404, headers });

    } catch (error) {
        console.error("Server Error:", error);
        // Ensure CORS headers are set even in error responses
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500, headers });
    }
}, { port: 8080 });

