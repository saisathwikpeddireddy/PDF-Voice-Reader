// Initialize PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// DOM Elements
const fileInput = document.getElementById('pdfFile');
const generateButton = document.getElementById('generateButton'); // New button for audio generation
const playButton = document.getElementById('playButton');
const pauseButton = document.getElementById('pauseButton');
const stopButton = document.getElementById('stopButton');
const voiceSelect = document.getElementById('voiceSelect');
const rateRange = document.getElementById('rateRange');
const progressBar = document.getElementById('progressBar');
const statusBar = document.getElementById('statusBar');
const fetchedChunksText = document.getElementById('fetchedChunks');
const totalChunksText = document.getElementById('totalChunks');
const totalDurationText = document.getElementById('totalDuration');
const pdfViewer = document.getElementById('pdfViewer');
const loadingMessage = document.getElementById('loadingMessage');
const fullScreenButton = document.getElementById('fullScreenButton');

let pdfDocument = null;
let fullText = ''; // Store the full text of the PDF
let audioChunks = []; // Store audio chunks
let chunkDurations = []; // Store duration of each audio chunk
let currentAudio = null; // Current audio object
let currentAudioIndex = 0; // Current audio chunk index
let isPlaying = false; // Playback state
let isGenerating = false; // State for audio generation process
let abortController = null; // AbortController to stop generation

// OpenAI API Configuration
const OPENAI_API_KEY = 'YOUR-API KEY'; // Replace with your OpenAI API key
const TTS_URL = 'https://api.openai.com/v1/audio/speech';

// Voice Options
const voices = [
    { name: 'Alloy', id: 'alloy' },
    { name: 'Echo', id: 'echo' },
    { name: 'Fable', id: 'fable' },
    { name: 'Onyx', id: 'onyx' },
    { name: 'Nova', id: 'nova' },
    { name: 'Shimmer', id: 'shimmer' }
];

// Load voices into dropdown
function loadVoices() {
    voiceSelect.innerHTML = voices.map(voice => `<option value="${voice.id}">${voice.name}</option>`).join('');
}
loadVoices();

// Handle PDF file upload
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onload = async function (event) {
            const typedarray = new Uint8Array(event.target.result);

            loadingMessage.style.display = 'block';

            // Load and render the PDF
            pdfDocument = await pdfjsLib.getDocument(typedarray).promise;
            await renderPDF(pdfDocument);

            // Extract text from the PDF
            fullText = await extractFullText(pdfDocument);

            loadingMessage.style.display = 'none';

            // Enable the generate button
            generateButton.disabled = false;
        };
        reader.readAsArrayBuffer(file);
    }
});

// Render PDF in the viewer
async function renderPDF(pdfDocument) {
    pdfViewer.innerHTML = ''; // Clear the viewer
    for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        pdfViewer.appendChild(canvas);
    }
}

// Extract full text from the PDF
async function extractFullText(pdfDocument) {
    let text = '';
    for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const textContent = await page.getTextContent();
        text += textContent.items.map(item => item.str).join(' ') + ' ';
    }
    return text.trim();
}

// Generate audio chunks
generateButton.addEventListener('click', async () => {
    if (isGenerating) return;

    isGenerating = true;
    audioChunks = [];
    chunkDurations = [];
    currentAudioIndex = 0;
    fetchedChunksText.textContent = '0';
    totalChunksText.textContent = '0';
    totalDurationText.textContent = '0 min';
    updateStatusBar("Starting audio generation...");

    try {
        abortController = new AbortController();
        await fetchAudioChunks(fullText, abortController.signal);

        // Enable controls after audio is generated
        playButton.disabled = false;
        stopButton.disabled = false;

        updateStatusBar("Audio generation complete.");
    } catch (error) {
        if (error.name === 'AbortError') {
            updateStatusBar("Audio generation stopped.");
        } else {
            console.error("Error during audio generation:", error);
            updateStatusBar("Error during audio generation. Check console for details.");
        }
    } finally {
        isGenerating = false;
        abortController = null;
    }
});


// Fetch audio chunks using OpenAI API
async function fetchAudioChunks(fullText, signal) {
    const chunkSize = 4000; // Maximum chunk size
    const chunks = splitTextIntoChunks(fullText, chunkSize);
    totalChunksText.textContent = chunks.length;

    for (let i = 0; i < chunks.length; i++) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        updateStatusBar(`Fetching chunk ${i + 1} of ${chunks.length}`);
        const audioUrl = await fetchAudioFromAPI(chunks[i], voiceSelect.value, signal);
        const duration = await getAudioDuration(audioUrl);
        audioChunks.push(audioUrl);
        chunkDurations.push(duration);

        fetchedChunksText.textContent = audioChunks.length;
        updateTotalDuration();
    }
}

// Fetch audio for a single chunk
async function fetchAudioFromAPI(text, voiceId, signal) {
    const response = await fetch(TTS_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'tts-1',
            voice: voiceId,
            input: text
        }),
        signal
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API Error: ${response.statusText}, ${errorText}`);
    }

    const audioBlob = await response.blob();
    return URL.createObjectURL(audioBlob);
}


// Split text into chunks
function splitTextIntoChunks(text, size) {
    const regex = new RegExp(`.{1,${size}}(\\s|$)`, 'g'); // Split at word boundaries
    return text.match(regex) || [text];
}

// Get audio duration
async function getAudioDuration(audioUrl) {
    return new Promise((resolve, reject) => {
        const audio = new Audio(audioUrl);
        audio.addEventListener('loadedmetadata', () => resolve(audio.duration));
        audio.addEventListener('error', () => reject(new Error("Error loading audio file")));
    });
}

// Update total duration
function updateTotalDuration() {
    const totalMinutes = Math.floor(chunkDurations.reduce((sum, dur) => sum + dur, 0) / 60);
    totalDurationText.textContent = `${totalMinutes} min`;
}

// Play audio
// Play audio
function playAudio() {
    if (currentAudioIndex >= audioChunks.length) {
        updateStatusBar("Playback complete.");
        return;
    }

    if (!currentAudio) {
        currentAudio = new Audio(audioChunks[currentAudioIndex]);
        currentAudio.playbackRate = parseFloat(rateRange.value);

        currentAudio.ontimeupdate = () => {
            if (currentAudio) {
                progressBar.value = (currentAudio.currentTime / currentAudio.duration) * 100;
            }
        };

        currentAudio.onended = () => {
            currentAudioIndex++;
            currentAudio = null;
            playAudio(); // Play the next chunk
        };
    }

    currentAudio.play();
    isPlaying = true;
    updateStatusBar(`Playing chunk ${currentAudioIndex + 1}`);
    playButton.disabled = true; // Disable Play when audio is playing
    pauseButton.disabled = false; // Enable Pause
    stopButton.disabled = false; // Enable Stop
}

// Pause audio
function pauseAudio() {
    if (currentAudio && isPlaying) {
        currentAudio.pause();
        isPlaying = false;

        playButton.disabled = false; // Enable Play button
        pauseButton.disabled = true; // Disable Pause button
        updateStatusBar("Playback paused.");
    }
}

// Attach the event listener to the button
pauseButton.addEventListener('click', pauseAudio);


// Stop audio
function stopAudio() {
    if (currentAudio) {
        currentAudio.pause(); // Pause the audio
        currentAudio.currentTime = 0; // Reset playback to the beginning
        currentAudio = null; // Clear the current audio object
    }

    isPlaying = false; // Update playback state
    currentAudioIndex = 0; // Reset the chunk index
    progressBar.value = 0; // Reset the progress bar

    // Enable Play button and disable Pause button
    playButton.disabled = false;
    pauseButton.disabled = true;
    stopButton.disabled = true;

    updateStatusBar("Playback stopped."); // Update the status bar
}

// Attach the event listener to the Stop button
stopButton.addEventListener('click', stopAudio);

// Update speed display dynamically
const rateValueDisplay = document.getElementById('rateValue'); // Ensure you have an element with ID "rateValue"

rateRange.addEventListener('input', () => {
    const playbackRate = parseFloat(rateRange.value).toFixed(1); // Get the slider value
    rateValueDisplay.textContent = `${playbackRate}x`; // Update the display
    if (currentAudio) {
        currentAudio.playbackRate = playbackRate; // Adjust playback rate of current audio
    }
});


// Play Audio

playButton.addEventListener('click', playAudio);
pauseButton.addEventListener('click', pauseAudio);
stopButton.addEventListener('click', stopAudio);

// Interactive progress bar
progressBar.addEventListener('click', (e) => {
    if (currentAudio) {
        const rect = progressBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const newTime = (clickX / progressBar.offsetWidth) * currentAudio.duration;

        currentAudio.currentTime = newTime; // Set the new time
        updateStatusBar(`Seeking to ${Math.floor(newTime)} seconds`);
    } else {
        updateStatusBar("No audio is currently playing.");
    }
});

// Fullscreen button
fullScreenButton.addEventListener('click', () => {
    if (pdfViewer.requestFullscreen) {
        pdfViewer.requestFullscreen();
    } else if (pdfViewer.mozRequestFullScreen) { // Firefox
        pdfViewer.mozRequestFullScreen();
    } else if (pdfViewer.webkitRequestFullscreen) { // Safari/Chrome/Opera
        pdfViewer.webkitRequestFullscreen();
    } else if (pdfViewer.msRequestFullscreen) { // IE/Edge
        pdfViewer.msRequestFullscreen();
    } else {
        updateStatusBar("Fullscreen mode not supported by your browser.");
    }
});


// Update status bar
function updateStatusBar(message) {
    statusBar.textContent = `Status: ${message}`;
}
