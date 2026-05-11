let rtpChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    const runBtn = document.getElementById('runBtn');
    const btnText = document.querySelector('.btn-text');
    const btnLoader = document.getElementById('btnLoader');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    runBtn.addEventListener('click', async () => {
        const numSpins = parseInt(document.getElementById('numSpins').value) || 1000000;
        const wildWeight = parseFloat(document.getElementById('wildWeight').value) || 4.238;
        const coinProb = parseFloat(document.getElementById('coinProb').value) || 0.05;

        // UI State: Running
        runBtn.disabled = true;
        btnText.style.display = 'none';
        btnLoader.style.display = 'block';
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.innerText = '0%';

        // Initialize Engine
        const sim = new Simulation();
        sim.setupGame(wildWeight, coinProb);

        // Run
        const results = await sim.runSimulation(numSpins, (percent) => {
            progressBar.style.width = `${percent}%`;
            progressText.innerText = `${percent.toFixed(1)}%`;
        });

        // UI State: Done
        runBtn.disabled = false;
        btnText.style.display = 'block';
        btnLoader.style.display = 'none';
        progressContainer.style.display = 'none';

        updateMetrics(results);
        renderChart(results);
    });
});

function updateMetrics(results) {
    document.getElementById('mTotalRtp').innerText = (results.total_rtp * 100).toFixed(2) + '%';
    
    // Color code RTP
    const rtpEl = document.getElementById('mTotalRtp');
    if (results.total_rtp * 100 >= 94 && results.total_rtp * 100 <= 96) {
        rtpEl.style.color = 'var(--success-color)';
    } else {
        rtpEl.style.color = '#ef4444'; // red if outside ideal range
    }

    document.getElementById('mVol').innerText = results.volatility.toFixed(2);
    document.getElementById('mHitRate').innerText = (results.hit_rate * 100).toFixed(2) + '%';
    
    document.getElementById('mBonusFreq').innerText = results.bonus_freq > 0 
        ? `1 in ${Math.round(results.bonus_freq)}` 
        : 'None';
        
    document.getElementById('mHsFreq').innerText = results.hs_freq > 0 
        ? `1 in ${Math.round(results.hs_freq)}` 
        : 'None';
}

function renderChart(results) {
    const ctx = document.getElementById('rtpChart').getContext('2d');
    
    const baseRtp = results.base_rtp * 100;
    const bonusRtp = results.bonus_rtp * 100;
    const hsRtp = results.hs_rtp * 100;
    const houseEdge = Math.max(0, 100 - (results.total_rtp * 100));

    const data = {
        labels: ['Base Game RTP', 'Bonus RTP', 'Hold & Spin RTP', 'House Edge'],
        datasets: [{
            data: [baseRtp, bonusRtp, hsRtp, houseEdge],
            backgroundColor: [
                '#4c72b0', // Blue
                '#55a868', // Green
                '#c44e52', // Red
                'rgba(255, 255, 255, 0.1)' // Gray/transparent for House Edge
            ],
            borderWidth: 0,
            hoverOffset: 4
        }]
    };

    if (rtpChartInstance) {
        rtpChartInstance.destroy();
    }

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Space Grotesk', sans-serif";

    rtpChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.label}: ${context.raw.toFixed(2)}%`;
                        }
                    },
                    backgroundColor: 'rgba(11, 15, 25, 0.9)',
                    titleFont: { size: 14 },
                    bodyFont: { size: 14 },
                    padding: 12,
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1
                }
            }
        }
    });
}
