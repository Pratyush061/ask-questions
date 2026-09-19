/* Hand Quiz — question bank + game state machine.
   Questions are in Hindi (Devanagari): 15 about India + 5 about the world,
   mostly easy — designed to be read by everyone including elderly players.

   The lock-in is TIME-based (~0.8 s) instead of frame-based, so it feels
   the same on fast and slow devices, and is forgiving for slow or
   trembling hands.

   No DOM / CDN dependencies, so it can be unit-tested with plain Node:
   node quiz.test.mjs */

export const STABLE_SECONDS = 0.8; // seconds a finger count must be held
export const FEEDBACK_SECONDS = 2.0; // a little longer, for comfortable reading

export const QUESTIONS = [
  { prompt: "भारत की राजधानी क्या है?",
    options: ["मुंबई", "नई दिल्ली", "कोलकाता", "चेन्नई"], answer: 2 },
  { prompt: "भारत का राष्ट्रीय पक्षी कौन सा है?",
    options: ["तोता", "कबूतर", "हंस", "मोर"], answer: 4 },
  { prompt: "ताजमहल किस शहर में स्थित है?",
    options: ["जयपुर", "आगरा", "दिल्ली", "लखनऊ"], answer: 2 },
  { prompt: "ताजमहल का निर्माण किसने करवाया था?",
    options: ["अकबर", "शाहजहाँ", "औरंगज़ेब", "हुमायूँ"], answer: 2 },
  { prompt: "भारत का राष्ट्रगान क्या है?",
    options: ["वंदे मातरम्", "सारे जहाँ से अच्छा", "जन गण मन", "जय जवान जय किसान"], answer: 3 },
  { prompt: "भारतीय ध्वज में सबसे ऊपर कौन सा रंग होता है?",
    options: ["हरा", "सफेद", "केसरिया", "नीला"], answer: 3 },
  { prompt: "भारत के पहले प्रधानमंत्री कौन थे?",
    options: ["महात्मा गांधी", "सरदार पटेल", "लाल बहादुर शास्त्री", "जवाहरलाल नेहरू"], answer: 4 },
  { prompt: "भारत की सबसे लंबी नदी कौन सी है?",
    options: ["गंगा", "यमुना", "गोदावरी", "कावेरी"], answer: 1 },
  { prompt: "भारत का राष्ट्रीय पशु कौन सा है?",
    options: ["शेर", "हाथी", "बाघ", "गाय"], answer: 3 },
  { prompt: "दिवाली किस चीज़ का त्योहार है?",
    options: ["रंगों का", "राखी का", "पतंगों का", "दीपों और रोशनी का"], answer: 4 },
  { prompt: "क्रिकेट के एक ओवर में कितनी गेंदें फेंकी जाती हैं?",
    options: ["4", "5", "6", "8"], answer: 3 },
  { prompt: "सचिन तेंदुलकर किस खेल के महान खिलाड़ी हैं?",
    options: ["हॉकी", "फुटबॉल", "टेनिस", "क्रिकेट"], answer: 4 },
  { prompt: "चंद्रयान-3 चाँद पर किस वर्ष सफलतापूर्वक उतरा?",
    options: ["2019", "2021", "2022", "2023"], answer: 4 },
  { prompt: "UPI डिजिटल भुगतान प्रणाली किस देश की है?",
    options: ["नेपाल", "भारत", "श्रीलंका", "जापान"], answer: 2 },
  { prompt: "होली का त्योहार किस चीज़ के लिए प्रसिद्ध है?",
    options: ["रंगों के लिए", "दीयों के लिए", "मिठाई के लिए", "उपवास के लिए"], answer: 1 },
  { prompt: "विश्व की सबसे ऊँची पर्वत चोटी कौन सी है?",
    options: ["के-टू", "कंचनजंगा", "माउंट एवरेस्ट", "मकालू"], answer: 3 },
  { prompt: "पृथ्वी अपनी धुरी पर एक चक्कर कितने घंटों में पूरा करती है?",
    options: ["12", "24", "36", "48"], answer: 2 },
  { prompt: "विश्व का सबसे बड़ा महासागर कौन सा है?",
    options: ["अटलांटिक", "हिंद", "आर्कटिक", "प्रशांत"], answer: 4 },
  { prompt: "सूर्य किस दिशा में उगता है?",
    options: ["पूर्व", "पश्चिम", "उत्तर", "दक्षिण"], answer: 1 },
  { prompt: "गुरुत्वाकर्षण का नियम किसने खोजा था?",
    options: ["अल्बर्ट आइंस्टीन", "गैलीलियो", "आइज़क न्यूटन", "चार्ल्स डार्विन"], answer: 3 },
];

export class QuizGame {
  constructor(questions = QUESTIONS) {
    this.allQuestions = questions;
    this.restart();
  }

  restart() {
    this.questions = [...this.allQuestions].sort(() => Math.random() - 0.5);
    this.index = 0;
    this.score = 0;
    this.phase = "intro"; // intro -> question -> feedback -> done
    this.elapsed = 0;
    this.lastAnswer = null;
    this.lastCorrect = null;
    this._lastCount = 0;
    this._holdTime = 0;
  }

  get currentQuestion() {
    return this.questions[this.index];
  }

  get total() {
    return this.questions.length;
  }

  update(counts, dt) {
    this.elapsed += dt;
    const best = counts.length ? Math.max(...counts) : 0;
    if (best === this._lastCount) {
      this._holdTime += dt;
    } else {
      this._lastCount = best;
      this._holdTime = 0;
    }
    const stable = this._holdTime >= STABLE_SECONDS;

    if (this.phase === "intro") {
      if (best >= 1 && stable) this._startQuestion();
    } else if (this.phase === "question") {
      if (best >= 1 && best <= 4 && stable) this._submit(best);
    } else if (this.phase === "feedback") {
      if (this.elapsed >= FEEDBACK_SECONDS) {
        this.index += 1;
        this.elapsed = 0;
        if (this.index >= this.questions.length) {
          this.phase = "done";
        } else {
          this._startQuestion();
        }
      }
    } else if (this.phase === "done") {
      if (best >= 1 && stable) this.restart();
    }
  }

  _startQuestion() {
    this.phase = "question";
    this.elapsed = 0;
    this._lastCount = 0;
    this._holdTime = 0;
  }

  _submit(answer) {
    this.lastAnswer = answer;
    this.lastCorrect = answer === this.currentQuestion.answer;
    if (this.lastCorrect) this.score += 1;
    this.phase = "feedback";
    this.elapsed = 0;
  }

  heldCount() {
    return this._lastCount >= 1 ? this._lastCount : 0;
  }

  lockProgress() {
    if (this._lastCount < 1) return 0;
    return Math.min(1, this._holdTime / STABLE_SECONDS);
  }
}
