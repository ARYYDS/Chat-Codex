class Odometer {
    constructor(elementId) {
        this.container = document.getElementById(elementId);
        this.value = 0;
    }

    setValue(num) {
        if (this.value === num) return;
        this.value = num;
        if (!this.container) return;
        this.container.textContent = Number(num).toLocaleString();
        this.container.classList.add('pulse');
        setTimeout(() => this.container.classList.remove('pulse'), 400);
    }
}

window.Odometer = Odometer;
