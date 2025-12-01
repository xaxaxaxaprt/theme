import { before, after } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";
import { showToast } from "@vendetta/ui/toasts";
import { constants } from "@vendetta/metro/common";

const MessageActions = findByProps("sendMessage");
const UploadModule = findByProps("uploadFiles", "upload");
const RestAPI = findByProps("getAPIBaseURL");

let patches = [];

const MESSAGE_FLAGS = {
  IS_VOICE_MESSAGE: 1 << 13
};

export default {
  onLoad: () => {
    try {
      console.log("[MP3ToVoice] Plugin yukleniyor...");

      const unpatchUpload = before("uploadFiles", UploadModule, async (args) => {
        try {
          const [channelId, files, draftType, options] = args;
          
          if (!files || !Array.isArray(files)) return;

          const mp3Files = files.filter(file => 
            file.filename?.toLowerCase().endsWith('.mp3') || 
            file.mimeType === 'audio/mpeg' ||
            file.type === 'audio/mpeg'
          );

          if (mp3Files.length === 0) return;

          args[1] = files.filter(f => !mp3Files.includes(f));

          for (const mp3File of mp3Files) {
            await sendAsVoiceMessage(channelId, mp3File);
          }

        } catch (error) {
          console.error("[MP3ToVoice] Upload patch hatasi:", error);
          showToast("MP3 gonderilemedi: " + error.message, "error");
        }
      });

      patches.push(unpatchUpload);
      showToast("MP3 to Voice Message aktif", "success");

    } catch (error) {
      console.error("[MP3ToVoice] Yukleme hatasi:", error);
      showToast("Plugin yukleme hatasi: " + error.message, "error");
    }
  },

  onUnload: () => {
    patches.forEach(p => p());
    patches = [];
    showToast("MP3 to Voice Message kapatildi", "info");
  }
};

async function sendAsVoiceMessage(channelId, mp3File) {
  try {
    showToast("MP3 donusturuluyor...", "info");

    const fileData = await readFileAsArrayBuffer(mp3File);
    const fileSize = fileData.byteLength;

    const uploadData = await getUploadUrl(channelId, fileSize);
    
    await uploadFile(uploadData.upload_url, fileData);

    const duration = estimateDuration(fileSize);
    const waveform = generateWaveform();

    await sendVoiceMessage(channelId, {
      uploadedFilename: uploadData.upload_filename,
      filename: "voice-message.ogg",
      duration: duration,
      waveform: waveform
    });

    showToast("Voice message gonderildi", "success");

  } catch (error) {
    console.error("[MP3ToVoice] Gonderme hatasi:", error);
    showToast("Voice message gonderilemedi: " + error.message, "error");
  }
}

async function getUploadUrl(channelId, fileSize) {
  const baseURL = RestAPI.getAPIBaseURL();
  const response = await fetch(`${baseURL}/v10/channels/${channelId}/attachments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": window.GLOBAL_ENV.TOKEN
    },
    body: JSON.stringify({
      files: [{
        filename: "voice-message.ogg",
        file_size: fileSize,
        id: "0"
      }]
    })
  });

  if (!response.ok) {
    throw new Error(`Upload URL alinamadi: ${response.status}`);
  }

  const data = await response.json();
  return {
    upload_url: data.attachments[0].upload_url,
    upload_filename: data.attachments[0].upload_filename
  };
}

async function uploadFile(uploadUrl, fileData) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "audio/mpeg"
    },
    body: fileData
  });

  if (!response.ok) {
    throw new Error(`Dosya yukleme hatasi: ${response.status}`);
  }
}

async function sendVoiceMessage(channelId, { uploadedFilename, filename, duration, waveform }) {
  const baseURL = RestAPI.getAPIBaseURL();
  const response = await fetch(`${baseURL}/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": window.GLOBAL_ENV.TOKEN
    },
    body: JSON.stringify({
      flags: MESSAGE_FLAGS.IS_VOICE_MESSAGE,
      attachments: [{
        id: "0",
        filename: filename,
        uploaded_filename: uploadedFilename,
        duration_secs: duration,
        waveform: waveform
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mesaj gonderilemedi: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function generateWaveform() {
  const samples = 256;
  const waveform = new Uint8Array(samples);
  
  for (let i = 0; i < samples; i++) {
    const sine = Math.sin(i / 20) * 0.5;
    const noise = (Math.random() - 0.5) * 0.3;
    const value = ((sine + noise + 1) / 2) * 255;
    waveform[i] = Math.floor(Math.max(0, Math.min(255, value)));
  }
  
  let binary = '';
  for (let i = 0; i < waveform.length; i++) {
    binary += String.fromCharCode(waveform[i]);
  }
  return btoa(binary);
}

function estimateDuration(fileSize) {
  const bytesPerSecond = 16000;
  const duration = Math.floor(fileSize / bytesPerSecond);
  return Math.max(1, Math.min(duration, 3600));
}
