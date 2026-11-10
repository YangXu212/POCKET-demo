# POCKET: A Factorized Kalman Control Network for Low-Complexity Acoustic Echo Cancellation

Yang Xu, Ze Li, Ronghui Hu, Shiruo Sun, Yuxiang Hu, Kai Chen, and Jing Lu

Supplementary audio examples with synchronized method switching, spectrograms, and per-example metrics.

**[Listen to the audio examples](https://yangxu212.github.io/POCKET-demo/)**

## Audio collection

| Data domain | Examples |
| --- | ---: |
| Linear synthetic | 13 |
| AEC Challenge synthetic | 8 |
| Recorded vehicle-echo mixtures | 12 |
| AEC Challenge real recordings | 6 |
| **Total** | **39** |

Each example includes the microphone input, **NLMS, STFT-KF, HB-DNN-NLMS, Meta-AF, NKF, Neural-MLMS, and POCKET**. A target signal is provided where available. The collection covers single-talk, double-talk, echo-path changes, movement, and clean/noisy conditions.

Audio is mono, 16 kHz, 24-bit PCM. Methods share a common time interval and playback gain within each example. Spectrograms use a fixed −90 to 0 dBFS scale. Source identifiers, processing details, and metrics are stored in [data/manifest.json](data/manifest.json).

POCKET uses the paper checkpoints with `ReLU(Re(P))`, `FIRST1`, and `Cap1.5`. Model source code and checkpoints are not included in this repository.

## Local use

Run from this directory:

```sh
python -m http.server 8770 --bind 127.0.0.1
```

Open [http://127.0.0.1:8770](http://127.0.0.1:8770) in a browser. Select an example, then click a method to play or switch tracks at the current position. Click a spectrogram to seek.

## Sources and attribution

- **AEC Challenge:** synthetic components and real recordings from the [Microsoft AEC Challenge](https://github.com/microsoft/AEC-Challenge), described by Cutler et al. in the ICASSP 2022 and ICASSP 2023 challenge papers.
- **Speech:** the [Microsoft DNS Challenge](https://github.com/microsoft/DNS-Challenge) supplies speech for the linear synthetic and vehicle-echo mixtures.
- **Room responses:** the linear synthetic RIR pool includes simulated responses and the [Aachen Impulse Response database](https://www.iks.rwth-aachen.de/en/research/tools-downloads/databases/), described by Jeub, Schäfer, and Vary.
- **Vehicle recordings and noise:** vehicle reference–echo pairs were collected for this work; noisy mixtures use [DEMAND](https://zenodo.org/records/1227121), by Thiemann, Ito, and Vincent. Noisy targets retain background noise.

Third-party audio and derived examples remain subject to their source-specific licenses and attribution requirements. See the linked dataset pages for the applicable terms.
