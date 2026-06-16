import SwiftUI
import WidgetKit

struct GoalEntry: TimelineEntry {
    let date: Date
    let todayMinutes: Int
    let goalMinutes: Int

    var fraction: Double {
        guard goalMinutes > 0 else { return 0 }
        return min(1, Double(todayMinutes) / Double(goalMinutes))
    }
}

struct GoalProvider: TimelineProvider {
    func placeholder(in context: Context) -> GoalEntry {
        GoalEntry(date: Date(), todayMinutes: 18, goalMinutes: 30)
    }

    func getSnapshot(in context: Context, completion: @escaping (GoalEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GoalEntry>) -> Void) {
        let entry = currentEntry()
        // Refresh around the next hour so a new day resets the ring.
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func currentEntry() -> GoalEntry {
        let snap = SharedStore.read()
        return GoalEntry(date: Date(), todayMinutes: snap.todayMinutes, goalMinutes: snap.goalMinutes)
    }
}

struct DailyGoalWidget: Widget {
    let kind = "DailyGoalWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: GoalProvider()) { entry in
            DailyGoalWidgetView(entry: entry)
        }
        .configurationDisplayName("Daily Reading Goal")
        .description("Track today's reading minutes against your goal.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct DailyGoalWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GoalEntry

    var body: some View {
        switch family {
        case .systemMedium: mediumBody
        default: smallBody
        }
    }

    private var ring: some View {
        ZStack {
            Circle().stroke(Color.secondary.opacity(0.2), lineWidth: 10)
            Circle()
                .trim(from: 0, to: entry.fraction)
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text("\(entry.todayMinutes)")
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .monospacedDigit()
                Text("min").font(.caption2).foregroundColor(.secondary)
            }
        }
    }

    private var smallBody: some View {
        VStack(spacing: 6) {
            ring
            Text(entry.goalMinutes > 0 ? "Goal \(entry.goalMinutes) min" : "Set a goal")
                .font(.caption2).foregroundColor(.secondary)
        }
        .padding()
    }

    private var mediumBody: some View {
        HStack(spacing: 16) {
            ring.frame(width: 90, height: 90)
            VStack(alignment: .leading, spacing: 6) {
                Text("Today's reading")
                    .font(.headline)
                if entry.fraction >= 1 {
                    Label("Goal reached", systemImage: "checkmark.seal.fill")
                        .font(.subheadline).foregroundColor(.green)
                } else {
                    Text("\(max(0, entry.goalMinutes - entry.todayMinutes)) min to go")
                        .font(.subheadline).foregroundColor(.secondary)
                }
                Text("Goal: \(entry.goalMinutes) min/day")
                    .font(.caption).foregroundColor(.secondary)
            }
            Spacer()
        }
        .padding()
    }
}
