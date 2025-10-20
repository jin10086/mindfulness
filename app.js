class MeditationAudioGenerator {
  constructor() {
    this.backgroundBuffers = {};
    this.bowlBuffer = null;
    this.isLoading = false;
    this.audioWorker = null;
    this.workerInitialized = false;

    this.initializeElements();
    this.bindEvents();
    this.initializeWorker();
    this.loadAudioFiles();
    this.loadUserPreferences();
  }

  initializeElements() {
    this.form = document.getElementById("meditationForm");
    this.durationInput = document.getElementById("duration");
    this.generateBtn = document.getElementById("generateBtn");
    this.loading = document.getElementById("loading");
    this.audioContainer = document.getElementById("audioContainer");
    this.generatedAudio = document.getElementById("generatedAudio");
  }

  bindEvents() {
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.generateMeditationAudio();
    });

    // 监听用户选择变化并保存
    const backgroundRadios = document.querySelectorAll(
      'input[name="backgroundSound"]'
    );
    backgroundRadios.forEach((radio) => {
      radio.addEventListener("change", () => this.saveUserPreferences());
    });

    this.durationInput.addEventListener("change", () =>
      this.saveUserPreferences()
    );
  }

  // 保存用户偏好设置到本地存储
  saveUserPreferences() {
    const selectedBackground =
      document.querySelector('input[name="backgroundSound"]:checked')?.value ||
      "rain";
    const duration = this.durationInput.value;

    const preferences = {
      backgroundSound: selectedBackground,
      duration: duration,
    };

    localStorage.setItem("meditationPreferences", JSON.stringify(preferences));
  }

  // 加载用户偏好设置
  loadUserPreferences() {
    const saved = localStorage.getItem("meditationPreferences");
    if (saved) {
      try {
        const preferences = JSON.parse(saved);

        // 设置背景音选择
        if (preferences.backgroundSound) {
          const radio = document.querySelector(
            `input[name="backgroundSound"][value="${preferences.backgroundSound}"]`
          );
          if (radio) {
            radio.checked = true;
          }
        }

        // 设置时长
        if (preferences.duration) {
          this.durationInput.value = preferences.duration;
        }
      } catch (e) {
        console.log("加载用户偏好设置失败:", e);
      }
    }
  }

  async loadAudioFiles() {
    try {
      console.log("开始加载音频文件...");

      // 加载背景音
      const rainBuffer = await this.loadAudioBuffer("./audio/rain.mp3");
      const seaBuffer = await this.loadAudioBuffer("./audio/sea.mp3");
      const waterBuffer = await this.loadAudioBuffer("./audio/water.mp3");

      this.backgroundBuffers = {
        rain: rainBuffer,
        sea: seaBuffer,
        water: waterBuffer,
      };

      // 加载钵声
      this.bowlBuffer = await this.loadAudioBuffer("./audio/bowl.mp3");

      console.log("所有音频文件加载完成");
    } catch (error) {
      console.error("音频文件加载失败:", error);

      // 提供更具体的错误信息
      let errorMessage = "音频文件加载失败：";
      if (
        error.message.includes("404") ||
        error.message.includes("Not Found")
      ) {
        errorMessage += "音频文件不存在，请检查文件路径";
      } else if (
        error.message.includes("网络") ||
        error.message.includes("fetch")
      ) {
        errorMessage += "网络连接问题，请检查网络连接";
      } else if (
        error.message.includes("解码") ||
        error.message.includes("decode")
      ) {
        errorMessage += "音频文件格式不支持或文件损坏";
      } else {
        errorMessage += "请检查文件路径和网络连接";
      }

      alert(errorMessage);
    }
  }

  async loadAudioBuffer(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return await Tone.getContext().decodeAudioData(arrayBuffer);
    } catch (error) {
      console.error(`加载音频文件失败 ${url}:`, error);
      throw error;
    }
  }

  initializeWorker() {
    try {
      this.audioWorker = new Worker('./audio-worker.js');
      
      this.audioWorker.onmessage = (e) => {
        const { type, data } = e.data;
        
        switch (type) {
          case 'init-complete':
            this.workerInitialized = data.success;
            if (!data.success) {
              console.error('Worker initialization failed:', data.error);
            }
            break;
            
          case 'progress':
            this.updateProgress(data.percentage, data.text, data.details);
            break;
            
          case 'synthesis-complete':
            this.handleWorkerSynthesisComplete(data.audioBlob);
            break;
            
          case 'error':
            this.handleWorkerError(data);
            break;
        }
      };
      
      this.audioWorker.onerror = (error) => {
        console.error('Worker error:', error);
        this.workerInitialized = false;
      };
      
      // 初始化Worker
      this.audioWorker.postMessage({ type: 'init' });
      
    } catch (error) {
      console.error('Failed to create worker:', error);
      this.workerInitialized = false;
    }
  }

  async synthesizeAudioWithWorker(backgroundType, durationMinutes) {
    return new Promise((resolve, reject) => {
      if (!this.audioWorker || !this.workerInitialized) {
        reject(new Error('Web Worker未初始化，将使用主线程处理'));
        return;
      }
      
      this.workerResolve = resolve;
      this.workerReject = reject;
      
      this.audioWorker.postMessage({
        type: 'synthesize',
        data: { backgroundType, durationMinutes }
      });
    });
  }

  handleWorkerSynthesisComplete(audioBlob) {
    if (this.workerResolve) {
      this.workerResolve(audioBlob);
      this.workerResolve = null;
      this.workerReject = null;
    }
  }

  handleWorkerError(errorData) {
    console.error('Worker synthesis error:', errorData);
    if (this.workerReject) {
      this.workerReject(new Error(errorData.message));
      this.workerResolve = null;
      this.workerReject = null;
    }
  }

  async generateMeditationAudio() {
    if (this.isLoading) return;

    const backgroundRadio = document.querySelector(
      'input[name="backgroundSound"]:checked'
    );
    const backgroundType = backgroundRadio ? backgroundRadio.value : null;
    const duration = parseInt(this.durationInput.value);

    if (!backgroundType || !duration) {
      alert("请选择背景音和设置时长");
      return;
    }

    if (duration < 2) {
      alert("时长至少需要2分钟");
      return;
    }

    this.showLoading(true);
    this.updateProgress(0, "初始化音频处理器...", "准备生成音频");

    try {
      // 使用Web Worker进行音频处理
      const audioBlob = await this.synthesizeAudioWithWorker(backgroundType, duration);
      
      this.updateProgress(100, "音频生成完成！", "正在准备播放器");
      this.displayGeneratedAudio(audioBlob);
    } catch (error) {
      console.error("Web Worker音频生成失败:", error);
      
      // 如果Web Worker失败，回退到主线程处理
      if (error.message.includes('Web Worker未初始化')) {
        console.log("回退到主线程处理音频生成");
        this.updateProgress(10, "回退到主线程处理", "正在初始化音频上下文");
        
        try {
          // 检查音频文件是否已加载
          const audioCheckResult = this.checkAudioFilesLoaded(backgroundType);
          if (!audioCheckResult.success) {
            alert(audioCheckResult.message);
            return;
          }

          await Tone.start();
          this.updateProgress(20, "音频上下文已就绪", "开始生成背景音频");

          const audioBlob = await this.synthesizeAudio(backgroundType, duration);
          
          this.updateProgress(100, "音频生成完成！", "正在准备播放器");
          this.displayGeneratedAudio(audioBlob);
          return;
        } catch (fallbackError) {
          console.error("主线程音频生成也失败:", fallbackError);
          error = fallbackError;
        }
      }

      // 提供更具体的错误信息
      let errorMessage = "音频生成失败：";
      if (error.message.includes("背景音未加载")) {
        errorMessage += "背景音文件未正确加载，请刷新页面重试";
      } else if (error.message.includes("钵声未加载")) {
        errorMessage += "钵声文件未正确加载，请刷新页面重试";
      } else if (error.message.includes("网络")) {
        errorMessage += "网络连接问题，请检查网络后重试";
      } else if (error.message.includes("解码")) {
        errorMessage += "音频文件格式错误或损坏";
      } else {
        errorMessage += error.message || "未知错误，请重试";
      }

      alert(errorMessage);
    } finally {
      this.showLoading(false);
    }
  }

  // 检查音频文件是否已加载
  checkAudioFilesLoaded(backgroundType) {
    // 检查背景音是否加载
    if (!this.backgroundBuffers[backgroundType]) {
      return {
        success: false,
        message: `背景音"${backgroundType}"未加载完成，请稍等片刻后重试`,
      };
    }

    // 检查钵声是否加载
    if (!this.bowlBuffer) {
      return {
        success: false,
        message: "钵声文件未加载完成，请稍等片刻后重试",
      };
    }

    return { success: true };
  }

  async synthesizeAudio(backgroundType, durationMinutes) {
    const durationSeconds = durationMinutes * 60;
    const sampleRate = 44100;
    const channels = 2;

    this.updateProgress(20, "创建音频上下文", `准备生成 ${durationMinutes} 分钟音频`);

    // 优化：使用更小的缓冲区大小来减少内存使用
    const bufferSize = Math.min(sampleRate * durationSeconds, sampleRate * 300); // 最大5分钟缓冲区
    const needsStreaming = durationSeconds > 300; // 超过5分钟使用流式处理

    // 创建离线音频上下文
    const offlineContext = new OfflineAudioContext(
      channels,
      bufferSize,
      sampleRate
    );

    // 获取背景音buffer
    const backgroundBuffer = this.backgroundBuffers[backgroundType];
    if (!backgroundBuffer) {
      throw new Error("背景音未加载");
    }

    this.updateProgress(30, "设置背景音频", "创建无缝循环背景音");

    if (needsStreaming) {
      // 对于长音频，使用分段处理
      return await this.synthesizeAudioInChunks(backgroundType, durationMinutes);
    } else {
      // 对于短音频，使用原有方法
      return await this.synthesizeAudioDirect(offlineContext, backgroundBuffer, durationMinutes);
    }
  }

  async synthesizeAudioDirect(offlineContext, backgroundBuffer, durationMinutes) {
    const durationSeconds = durationMinutes * 60;

    // 创建无缝循环的背景音
    await this.createSeamlessBackground(
      offlineContext,
      backgroundBuffer,
      durationSeconds
    );

    this.updateProgress(60, "添加钵声", "计算钵声插入时间点");

    // 计算钵声插入时间点
    const bowlTimes = this.calculateBowlTimes(durationMinutes);

    // 添加钵声
    await this.addBowlSounds(offlineContext, bowlTimes);

    this.updateProgress(80, "渲染音频", "正在合成最终音频文件");

    // 渲染音频
    const renderedBuffer = await offlineContext.startRendering();

    this.updateProgress(95, "转换格式", "准备音频下载");

    // 转换为Blob
    return this.audioBufferToBlob(renderedBuffer);
  }

  async synthesizeAudioInChunks(backgroundType, durationMinutes) {
    const chunkDuration = 5; // 每个块5分钟
    const totalChunks = Math.ceil(durationMinutes / chunkDuration);
    const audioChunks = [];

    for (let i = 0; i < totalChunks; i++) {
      const chunkStart = i * chunkDuration;
      const chunkEnd = Math.min((i + 1) * chunkDuration, durationMinutes);
      const actualChunkDuration = chunkEnd - chunkStart;

      this.updateProgress(
        30 + (i / totalChunks) * 50,
        `处理音频块 ${i + 1}/${totalChunks}`,
        `生成第 ${chunkStart}-${chunkEnd} 分钟`
      );

      const chunkBuffer = await this.generateAudioChunk(
        backgroundType,
        actualChunkDuration,
        chunkStart
      );
      
      audioChunks.push(chunkBuffer);
    }

    this.updateProgress(85, "合并音频块", "正在组合所有音频片段");

    // 合并所有音频块
    const finalBuffer = await this.mergeAudioChunks(audioChunks);

    this.updateProgress(95, "转换格式", "准备音频下载");

    return this.audioBufferToBlob(finalBuffer);
  }

  async generateAudioChunk(backgroundType, durationMinutes, startOffset) {
    const durationSeconds = durationMinutes * 60;
    const sampleRate = 44100;
    const channels = 2;

    const offlineContext = new OfflineAudioContext(
      channels,
      sampleRate * durationSeconds,
      sampleRate
    );

    const backgroundBuffer = this.backgroundBuffers[backgroundType];
    
    // 创建背景音
    await this.createSeamlessBackground(offlineContext, backgroundBuffer, durationSeconds);

    // 计算这个块中的钵声时间点
    const allBowlTimes = this.calculateBowlTimes(startOffset + durationMinutes);
    const chunkBowlTimes = allBowlTimes.filter(time => 
      time >= startOffset * 60 && time < (startOffset + durationMinutes) * 60
    ).map(time => time - startOffset * 60);

    if (chunkBowlTimes.length > 0) {
      await this.addBowlSounds(offlineContext, chunkBowlTimes);
    }

    return await offlineContext.startRendering();
  }

  async mergeAudioChunks(chunks) {
    if (chunks.length === 0) return null;
    if (chunks.length === 1) return chunks[0];

    const sampleRate = chunks[0].sampleRate;
    const channels = chunks[0].numberOfChannels;
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

    // 创建合并后的缓冲区
    const mergedBuffer = new AudioBuffer({
      numberOfChannels: channels,
      length: totalLength,
      sampleRate: sampleRate
    });

    let offset = 0;
    for (let channel = 0; channel < channels; channel++) {
      const mergedData = mergedBuffer.getChannelData(channel);
      offset = 0;
      
      for (const chunk of chunks) {
        const chunkData = chunk.getChannelData(channel);
        mergedData.set(chunkData, offset);
        offset += chunkData.length;
      }
    }

    return mergedBuffer;
  }

  async createSeamlessBackground(context, backgroundBuffer, durationSeconds) {
    const backgroundDuration = backgroundBuffer.duration;
    const sampleRate = backgroundBuffer.sampleRate;
    const channels = backgroundBuffer.numberOfChannels;

    // 优化：使用多个短循环而不是一个长buffer
    const loops = Math.ceil(durationSeconds / backgroundDuration);
    const crossfadeDuration = 0.1; // 减少交叉淡化时间到0.1秒
    const crossfadeSamples = Math.floor(sampleRate * crossfadeDuration);

    // 创建背景音增益节点
    const backgroundGain = context.createGain();
    backgroundGain.connect(context.destination);

    // 计算钵声时间点用于静音处理
    const bowlTimes = this.calculateBowlTimes(durationSeconds / 60);
    this.setupBackgroundMuting(backgroundGain, bowlTimes, context, durationSeconds);

    // 优化：使用多个BufferSource而不是创建巨大的buffer
    for (let loop = 0; loop < loops; loop++) {
      const startTime = loop * backgroundDuration;
      const endTime = Math.min((loop + 1) * backgroundDuration, durationSeconds);
      
      if (startTime >= durationSeconds) break;

      const source = context.createBufferSource();
      source.buffer = backgroundBuffer;
      
      // 如果是最后一个循环且需要截断
      if (endTime < (loop + 1) * backgroundDuration) {
        const truncatedBuffer = this.truncateBuffer(
          backgroundBuffer, 
          endTime - startTime, 
          context
        );
        source.buffer = truncatedBuffer;
      }

      // 添加交叉淡化
      if (loop > 0) {
        const fadeGain = context.createGain();
        source.connect(fadeGain);
        fadeGain.connect(backgroundGain);
        
        // 淡入效果
        fadeGain.gain.setValueAtTime(0, startTime);
        fadeGain.gain.linearRampToValueAtTime(1, startTime + crossfadeDuration);
      } else {
        source.connect(backgroundGain);
      }

      source.start(startTime);
    }
  }

  calculateBowlTimes(durationMinutes) {
    const times = [];

    // 在时长-1分钟和(时长-1)/2分钟插入钵声
    const endTime = durationMinutes - 1;
    const midTime = endTime / 2;

    if (midTime >= 1) {
      // 确保中间时间点至少在1分钟后
      times.push(midTime * 60); // 转换为秒
    }

    if (endTime >= 1) {
      times.push(endTime * 60); // 转换为秒
    }

    return times.sort((a, b) => a - b);
  }

  setupBackgroundMuting(gainNode, bowlTimes, context, durationSeconds) {
    // 开始时淡入背景音
    gainNode.gain.setValueAtTime(0, 0);
    gainNode.gain.linearRampToValueAtTime(1, 2); // 2秒淡入

    bowlTimes.forEach((time) => {
      // 钵声前1秒开始淡出
      gainNode.gain.setValueAtTime(1, time - 1);
      gainNode.gain.linearRampToValueAtTime(0, time);

      // 钵声后8秒开始淡入
      gainNode.gain.setValueAtTime(0, time + 8);
      gainNode.gain.linearRampToValueAtTime(1, time + 9); // 1秒淡入
    });

    // 结束前2秒开始淡出
    if (durationSeconds > 2) {
      gainNode.gain.setValueAtTime(1, durationSeconds - 2);
      gainNode.gain.linearRampToValueAtTime(0, durationSeconds);
    }
  }

  async addBowlSounds(context, bowlTimes) {
    if (!this.bowlBuffer) {
      throw new Error("钵声未加载");
    }

    bowlTimes.forEach((time) => {
      // 创建钵声源
      const bowlSource = context.createBufferSource();

      // 截取前8秒的钵声
      const bowlDuration = Math.min(8, this.bowlBuffer.duration);
      const truncatedBuffer = this.truncateBuffer(
        this.bowlBuffer,
        bowlDuration,
        context
      );
      bowlSource.buffer = truncatedBuffer;

      // 创建钵声增益节点用于淡入淡出
      const bowlGain = context.createGain();
      bowlSource.connect(bowlGain);
      bowlGain.connect(context.destination);

      // 设置淡入淡出
      this.setupBowlFadeInOut(bowlGain, time, bowlDuration, context);

      // 在指定时间开始播放
      bowlSource.start(time);
    });
  }

  truncateBuffer(originalBuffer, duration, context) {
    const sampleRate = originalBuffer.sampleRate;
    const samples = Math.floor(duration * sampleRate);
    const channels = originalBuffer.numberOfChannels;

    const truncatedBuffer = context.createBuffer(channels, samples, sampleRate);

    for (let channel = 0; channel < channels; channel++) {
      const originalData = originalBuffer.getChannelData(channel);
      const truncatedData = truncatedBuffer.getChannelData(channel);

      for (let i = 0; i < samples; i++) {
        truncatedData[i] = originalData[i];
      }
    }

    return truncatedBuffer;
  }

  setupBowlFadeInOut(gainNode, startTime, duration, context) {
    const fadeTime = 1; // 增加淡入淡出时间到1秒

    // 淡入
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(1, startTime + fadeTime);

    // 淡出
    gainNode.gain.setValueAtTime(1, startTime + duration - fadeTime);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
  }

  audioBufferToBlob(buffer) {
    const length = buffer.length;
    const channels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;

    // 创建WAV文件
    const arrayBuffer = new ArrayBuffer(44 + length * channels * 2);
    const view = new DataView(arrayBuffer);

    // WAV文件头
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + length * channels * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length * channels * 2, true);

    // 写入音频数据
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = Math.max(
          -1,
          Math.min(1, buffer.getChannelData(channel)[i])
        );
        view.setInt16(offset, sample * 0x7fff, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  displayGeneratedAudio(audioBlob) {
    const audioUrl = URL.createObjectURL(audioBlob);
    this.generatedAudio.src = audioUrl;
    this.audioContainer.classList.add("show");

    // 自动播放生成的音频
    this.generatedAudio.play().catch((error) => {
      console.log("自动播放失败，可能需要用户交互:", error);
    });

    // 滚动到音频播放器
    this.audioContainer.scrollIntoView({ behavior: "smooth" });
  }

  showLoading(show) {
    this.isLoading = show;
    this.generateBtn.disabled = show;

    if (show) {
      this.loading.classList.add("show");
      this.audioContainer.classList.remove("show");
    } else {
      this.loading.classList.remove("show");
    }
  }

  updateProgress(percentage, text, details) {
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const progressDetails = document.getElementById('progressDetails');
    
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
    
    if (progressText) {
      progressText.textContent = text;
    }
    
    if (progressDetails) {
      progressDetails.textContent = details;
    }
  }
}

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", () => {
  new MeditationAudioGenerator();
});
