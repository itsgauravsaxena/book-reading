import Charts
import CoreData
import SwiftUI

struct StatsView: View {
    @Environment(\.managedObjectContext) private var ctx
    @State private var range: StatsRange = .week

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(keyPath: \DailyGoalEntity.effectiveFrom, ascending: false)],
        animation: .default
    ) private var goals: FetchedResults<DailyGoalEntity>

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Picker("Range", selection: $range) {
                        ForEach(StatsRange.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    summaryCard
                    chartCard
                    streakCard
                }
                .padding()
                .animation(.easeInOut, value: range)
            }
            .navigationTitle("Stats")
        }
    }

    private var currentGoalMinutes: Int {
        Int(goals.first?.minutesPerDay ?? 0)
    }

    private var buckets: [DailyBucket] {
        let agg = StatsAggregator(context: ctx)
        let (start, end) = agg.rangeBounds(range)
        return agg.dailyTotals(from: start, to: end)
    }

    private var totalMinutes: Int {
        buckets.reduce(0) { $0 + $1.minutes }
    }

    private var avgMinutes: Int {
        let days = max(1, buckets.count)
        return totalMinutes / days
    }

    private var summaryCard: some View {
        HStack {
            stat(title: "Total", value: "\(totalMinutes)", unit: "min")
            Divider().frame(height: 36)
            stat(title: "Average/day", value: "\(avgMinutes)", unit: "min")
            Divider().frame(height: 36)
            stat(title: "Days read", value: "\(buckets.filter { $0.seconds > 0 }.count)", unit: "")
        }
        .padding()
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
    }

    private func stat(title: String, value: String, unit: String) -> some View {
        VStack(spacing: 2) {
            Text(title).font(.caption).foregroundColor(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(.title3.weight(.semibold)).monospacedDigit()
                if !unit.isEmpty {
                    Text(unit).font(.caption).foregroundColor(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var chartCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(chartTitle).font(.headline)
            Chart(buckets) { bucket in
                BarMark(
                    x: .value("Day", bucket.date, unit: .day),
                    y: .value("Minutes", bucket.minutes)
                )
                .foregroundStyle(Color.accentColor.gradient)
                .cornerRadius(4)

                if currentGoalMinutes > 0 {
                    RuleMark(y: .value("Goal", currentGoalMinutes))
                        .foregroundStyle(Color.orange.opacity(0.7))
                        .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                }
            }
            .chartXAxis { AxisMarks(values: .stride(by: xStride)) }
            .frame(height: 180)
        }
        .padding()
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
    }

    private var chartTitle: String {
        switch range {
        case .day:   return "Today"
        case .week:  return "Last 7 days"
        case .month: return "Last 30 days"
        case .year:  return "Last 12 months"
        }
    }

    private var xStride: Calendar.Component {
        switch range {
        case .day, .week: return .day
        case .month:      return .weekOfYear
        case .year:       return .month
        }
    }

    private var streakCard: some View {
        let streak = StatsAggregator(context: ctx)
            .currentStreak(minMinutes: max(1, currentGoalMinutes))
        return HStack(spacing: 12) {
            Image(systemName: "flame.fill")
                .font(.title)
                .foregroundColor(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Current streak").font(.caption).foregroundColor(.secondary)
                Text("\(streak) day\(streak == 1 ? "" : "s")")
                    .font(.title3.weight(.semibold))
                if currentGoalMinutes > 0 {
                    Text("Days hitting \(currentGoalMinutes) min goal")
                        .font(.caption2).foregroundColor(.secondary)
                }
            }
            Spacer()
        }
        .padding()
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
    }
}

struct StatsView_Previews: PreviewProvider {
    static var previews: some View {
        StatsView()
            .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
    }
}
