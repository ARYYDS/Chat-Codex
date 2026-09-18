/**
 * Chat-Codex Studio - Mechanical Odometer Component
 * Vanilla JavaScript class implementing mechanical digit rolling wheels.
 * Utilizes CSS transforms with cubic-bezier easing and glow pulses.
 */

class MechanicalOdometer {
  /**
   * @param {HTMLElement|string} element - Container element or selector
   * @param {Object} options - Configuration options
   * @param {number} [options.duration=450] - Animation transition duration in ms
   * @param {string} [options.easing='cubic-bezier(0.2, 1, 0.3, 1)'] - CSS easing function
   * @param {HTMLElement} [options.pulseTarget=null] - Element to apply pulse effect to on change
   * @param {Function} [options.formatter=null] - Optional formatting function for values
   */
  constructor(element, options = {}) {
    this.container = typeof element === 'string' ? document.querySelector(element) : element;
    if (!this.container) {
      throw new Error('[MechanicalOdometer] Invalid container element specified.');
    }

    this.options = {
      duration: options.duration || 450,
      easing: options.easing || 'cubic-bezier(0.2, 1, 0.3, 1)',
      pulseTarget: options.pulseTarget || this.container,
      formatter: options.formatter || null,
      ...options
    };

    this.currentValue = '';
    this.columns = [];
    this.container.classList.add('mechanical-odometer');
  }

  /**
   * Render or update odometer to a new value
   * @param {number|string} newValue
   */
  setValue(newValue) {
    const formatted = this.options.formatter ? this.options.formatter(newValue) : String(newValue);
    if (formatted === this.currentValue) return;

    const prevValue = this.currentValue;
    this.currentValue = formatted;

    const chars = formatted.split('');
    
    // Check if character structure matches existing columns
    let needsRebuild = this.columns.length !== chars.length;
    if (!needsRebuild) {
      for (let i = 0; i < chars.length; i++) {
        const isDigit = /\d/.test(chars[i]);
        if (this.columns[i].isDigit !== isDigit) {
          needsRebuild = true;
          break;
        }
      }
    }

    if (needsRebuild) {
      this._buildDOM(chars);
    } else {
      this._updateColumns(chars);
    }

    // Trigger visual micro-pulse if value changed
    if (prevValue !== '' && this.options.pulseTarget) {
      this._triggerPulse();
    }
  }

  getValue() {
    return this.currentValue;
  }

  _buildDOM(chars) {
    this.container.innerHTML = '';
    this.columns = [];

    const wrapper = document.createElement('div');
    wrapper.className = 'odo-wrapper';

    chars.forEach((char) => {
      const isDigit = /\d/.test(char);
      const col = document.createElement('div');
      col.className = isDigit ? 'odo-column odo-digit' : 'odo-column odo-symbol';

      if (isDigit) {
        const strip = document.createElement('div');
        strip.className = 'odo-strip';
        strip.style.transition = `transform ${this.options.duration}ms ${this.options.easing}`;

        // Digits 0 through 9
        for (let d = 0; d <= 9; d++) {
          const num = document.createElement('span');
          num.className = 'odo-num';
          num.textContent = String(d);
          strip.appendChild(num);
        }

        col.appendChild(strip);
        wrapper.appendChild(col);

        const digitVal = parseInt(char, 10);
        strip.style.transform = `translateY(-${digitVal * 10}%)`;

        this.columns.push({
          element: col,
          strip: strip,
          isDigit: true,
          char: char,
        });
      } else {
        const sym = document.createElement('span');
        sym.className = 'odo-symbol-char';
        sym.textContent = char;
        col.appendChild(sym);
        wrapper.appendChild(col);

        this.columns.push({
          element: col,
          strip: null,
          isDigit: false,
          char: char,
        });
      }
    });

    this.container.appendChild(wrapper);
  }

  _updateColumns(chars) {
    chars.forEach((char, index) => {
      const colData = this.columns[index];
      if (colData.isDigit) {
        const digitVal = parseInt(char, 10);
        if (colData.char !== char) {
          colData.strip.style.transform = `translateY(-${digitVal * 10}%)`;
          colData.char = char;
        }
      } else {
        if (colData.char !== char) {
          colData.element.querySelector('.odo-symbol-char').textContent = char;
          colData.char = char;
        }
      }
    });
  }

  _triggerPulse() {
    const target = this.options.pulseTarget;
    if (!target) return;

    target.classList.remove('odo-pulse-active');
    // Force reflow
    void target.offsetWidth;
    target.classList.add('odo-pulse-active');

    setTimeout(() => {
      target.classList.remove('odo-pulse-active');
    }, this.options.duration + 100);
  }

  destroy() {
    this.container.innerHTML = '';
    this.columns = [];
    this.currentValue = '';
  }
}

// Export for ES module and window global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MechanicalOdometer };
}
if (typeof window !== 'undefined') {
  window.MechanicalOdometer = MechanicalOdometer;
}
