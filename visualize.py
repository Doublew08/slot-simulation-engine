import csv
import matplotlib.pyplot as plt

def visualize_results(csv_filename="results.csv", output_image="rtp_chart.png"):
    # Read the data
    metrics = {}
    try:
        with open(csv_filename, 'r') as f:
            reader = csv.reader(f)
            next(reader) # skip header
            for row in reader:
                if len(row) == 2:
                    metrics[row[0]] = float(row[1])
    except FileNotFoundError:
        print(f"Could not find {csv_filename}. Please run the simulation first.")
        return

    # Extract RTP components
    labels = ['Base Game RTP', 'Bonus RTP', 'Hold & Spin RTP']
    values = [metrics.get('Base RTP', 0) * 100, 
              metrics.get('Bonus RTP', 0) * 100, 
              metrics.get('Hold and Spin RTP', 0) * 100]
    
    total_rtp = metrics.get('Total RTP', 0) * 100
    house_edge = max(0, 100.0 - total_rtp)
    
    # Add house edge to make the pie chart equal 100%
    pie_labels = labels + ['House Edge']
    pie_values = values + [house_edge]
    colors = ['#4c72b0', '#55a868', '#c44e52', '#333333']
    explode = (0.05, 0.05, 0.05, 0)

    # Set up the figure
    fig = plt.figure(figsize=(12, 6))
    
    # 1. Pie Chart: RTP Breakdown
    ax1 = fig.add_subplot(121)
    ax1.pie(pie_values, explode=explode, labels=pie_labels, colors=colors, autopct='%1.2f%%',
            shadow=True, startangle=90, textprops={'fontsize': 10})
    ax1.axis('equal')
    ax1.set_title(f"RTP Breakdown (Total: {total_rtp:.2f}%)", fontsize=14, pad=20)

    # 2. Bar Chart: Hit Rates & Frequencies
    ax2 = fig.add_subplot(122)
    
    base_hit = metrics.get('Base Hit Rate', 0) * 100
    # Convert frequencies (1 in X) to percentages
    bonus_freq = metrics.get('Bonus Trigger Frequency (1 in X)', 1)
    bonus_hit = (1.0 / bonus_freq) * 100 if bonus_freq > 0 else 0
    
    hs_freq = metrics.get('Hold and Spin Frequency (1 in X)', 1)
    hs_hit = (1.0 / hs_freq) * 100 if hs_freq > 0 else 0
    
    bar_labels = ['Base Hit\nRate', 'Bonus\nTrigger', 'Hold & Spin\nTrigger']
    bar_values = [base_hit, bonus_hit, hs_hit]
    
    bars = ax2.bar(bar_labels, bar_values, color=['#4c72b0', '#55a868', '#c44e52'])
    
    # Add value labels on top of bars
    for bar in bars:
        yval = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width()/2.0, yval, f"{yval:.2f}%", 
                 ha='center', va='bottom', fontsize=10)
                 
    ax2.set_ylabel("Hit Probability (%)")
    ax2.set_title("Feature Hit Probabilities", fontsize=14, pad=20)
    
    # Log scale only when all values are positive — zero crashes matplotlib log axis
    if all(v > 0 for v in bar_values):
        ax2.set_yscale('log')
        ax2.set_ylim(0.01, 100)
    else:
        ax2.set_ylim(0, max(bar_values) * 1.2 if any(v > 0 for v in bar_values) else 1)
    
    # Add Volatility text box
    volatility = metrics.get('Volatility', 0)
    textstr = f"Volatility Index: {volatility:.2f}"
    props = dict(boxstyle='round', facecolor='wheat', alpha=0.5)
    ax2.text(0.5, 0.95, textstr, transform=ax2.transAxes, fontsize=12,
            verticalalignment='top', horizontalalignment='center', bbox=props)

    plt.tight_layout()
    plt.savefig(output_image, dpi=300, bbox_inches='tight')
    print(f"Visualization saved to {output_image}")

if __name__ == "__main__":
    visualize_results()
