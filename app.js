class MeditationAudioGenerator {
  constructor() {
    this.backgroundBuffers = {};
    this.bowlBuffer = null;
    this.isLoading = false;

    this.initializeElements();
    this.bindEvents();
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
      const rainBuffer = await this.loadAudioBuffer("./audio/rain.wav");
      const seaBuffer = await this.loadAudioBuffer("./audio/sea.wav");

      this.backgroundBuffers = {
        rain: rainBuffer,
        sea: seaBuffer,
      };

      // 加载钵声
      this.bowlBuffer = await this.loadAudioBuffer("./audio/bowl.mp3");

      console.log("所有音频文件加载完成");
    } catch (error) {
      console.error("音频文件加载失败:", error);
      alert("音频文件加载失败，请检查文件路径");
    }
  }

  async loadAudioBuffer(url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return await Tone.getContext().decodeAudioData(arrayBuffer);
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

    try {
      await Tone.start();

      const audioBlob = await this.synthesizeAudio(backgroundType, duration);
      this.displayGeneratedAudio(audioBlob);
    } catch (error) {
      console.error("音频生成失败:", error);
      alert("音频生成失败，请重试");
    } finally {
      this.showLoading(false);
    }
  }

  async synthesizeAudio(backgroundType, durationMinutes) {
    const durationSeconds = durationMinutes * 60;
    const sampleRate = 44100;
    const channels = 2;

    // 创建离线音频上下文
    const offlineContext = new OfflineAudioContext(
      channels,
      sampleRate * durationSeconds,
      sampleRate
    );

    // 获取背景音buffer
    const backgroundBuffer = this.backgroundBuffers[backgroundType];
    if (!backgroundBuffer) {
      throw new Error("背景音未加载");
    }

    // 创建无缝循环的背景音
    await this.createSeamlessBackground(
      offlineContext,
      backgroundBuffer,
      durationSeconds
    );

    // 计算钵声插入时间点
    const bowlTimes = this.calculateBowlTimes(durationMinutes);

    // 添加钵声
    await this.addBowlSounds(offlineContext, bowlTimes);

    // 渲染音频
    const renderedBuffer = await offlineContext.startRendering();

    // 转换为Blob
    return this.audioBufferToBlob(renderedBuffer);
  }

  async createSeamlessBackground(context, backgroundBuffer, durationSeconds) {
    const backgroundDuration = backgroundBuffer.duration;
    const sampleRate = backgroundBuffer.sampleRate;
    const channels = backgroundBuffer.numberOfChannels;

    // 计算需要多少个完整循环
    const loops = Math.ceil(durationSeconds / backgroundDuration);

    // 创建一个足够长的buffer来容纳所有循环
    const totalSamples = Math.ceil(durationSeconds * sampleRate);
    const seamlessBuffer = context.createBuffer(
      channels,
      totalSamples,
      sampleRate
    );

    // 为每个声道填充数据
    for (let channel = 0; channel < channels; channel++) {
      const originalData = backgroundBuffer.getChannelData(channel);
      const seamlessData = seamlessBuffer.getChannelData(channel);
      const originalSamples = originalData.length;

      // 复制多个循环的数据
      for (let loop = 0; loop < loops; loop++) {
        const startSample = loop * originalSamples;
        const endSample = Math.min(startSample + originalSamples, totalSamples);

        for (let i = startSample; i < endSample; i++) {
          const sourceIndex = i - startSample;
          if (sourceIndex < originalSamples) {
            seamlessData[i] = originalData[sourceIndex];
          }
        }

        // 在循环边界添加交叉淡化以避免突兀
        if (loop > 0 && startSample < totalSamples) {
          const crossfadeSamples = Math.min(
            sampleRate * 2,
            originalSamples / 10
          ); // 2秒交叉淡化

          for (
            let i = 0;
            i < crossfadeSamples && startSample + i < totalSamples;
            i++
          ) {
            const fadeIn = i / crossfadeSamples;
            const fadeOut = 1 - fadeIn;

            const currentIndex = startSample + i;
            const prevIndex = currentIndex - originalSamples;

            if (prevIndex >= 0 && currentIndex < totalSamples) {
              seamlessData[currentIndex] =
                seamlessData[prevIndex] * fadeOut + originalData[i] * fadeIn;
            }
          }
        }
      }
    }

    // 创建背景音源和增益节点
    const backgroundSource = context.createBufferSource();
    backgroundSource.buffer = seamlessBuffer;

    const backgroundGain = context.createGain();
    backgroundSource.connect(backgroundGain);
    backgroundGain.connect(context.destination);

    // 计算钵声时间点用于静音处理
    const bowlTimes = this.calculateBowlTimes(durationSeconds / 60);

    // 设置背景音静音时间段
    this.setupBackgroundMuting(
      backgroundGain,
      bowlTimes,
      context,
      durationSeconds
    );

    // 开始播放
    backgroundSource.start(0);
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
}

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", () => {
  new MeditationAudioGenerator();
});
