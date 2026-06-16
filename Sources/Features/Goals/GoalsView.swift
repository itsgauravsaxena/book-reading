import CoreData
import SwiftUI

struct GoalsView: View {
    @Environment(\.managedObjectContext) private var ctx

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(keyPath: \DailyGoalEntity.effectiveFrom, ascending: false)],
        animation: .default
    ) private var goals: FetchedResults<DailyGoalEntity>

    @State private var minutesDraft: Double = 20

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    progressRing
                    goalEditor
                }
                .padding()
                .animation(.easeInOut, value: todaySeconds)
            }
            .navigationTitle("Daily Goal")
            .onAppear { minutesDraft = Double(goals.first?.minutesPerDay ?? 20) }
        }
    }

    private var goalMinutes: Int {
        Int(goals.first?.minutesPerDay ?? 0)
    }

    private var todaySeconds: Int {
        let req = NSFetchRequest<ReadingSessionEntity>(entityName: "ReadingSession")
        req.predicate = NSPredicate(format: "dayKey == %@", DayKey.today())
        let sessions = (try? ctx.fetch(req)) ?? []
        return sessions.reduce(0) { $0 + Int($1.durationSeconds) }
    }

    private var progress: Double {
        guard goalMinutes > 0 else { return 0 }
        return min(1, Double(todaySeconds) / Double(goalMinutes * 60))
    }

    private var progressRing: some View {
        ZStack {
            Circle()
                .stroke(Color.secondary.opacity(0.15), lineWidth: 18)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    AngularGradient(colors: [.accentColor, .accentColor.opacity(0.5), .accentColor],
                                    center: .center),
                    style: StrokeStyle(lineWidth: 18, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(.easeInOut(duration: 0.6), value: progress)
            VStack(spacing: 4) {
                Text("\(todaySeconds / 60)")
                    .font(.system(size: 56, weight: .light, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Text("of \(goalMinutes) min today")
                    .font(.subheadline).foregroundColor(.secondary)
                if progress >= 1 {
                    Label("Goal hit", systemImage: "checkmark.seal.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.green)
                        .padding(.top, 2)
                }
            }
        }
        .frame(width: 220, height: 220)
        .padding(.vertical, 8)
    }

    private var goalEditor: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Target minutes per day").font(.headline)
            HStack {
                Text("5").font(.caption).foregroundColor(.secondary)
                Slider(value: $minutesDraft, in: 5...180, step: 5)
                Text("180").font(.caption).foregroundColor(.secondary)
            }
            HStack {
                Text("\(Int(minutesDraft)) min")
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Spacer()
                Button {
                    saveGoal(Int(minutesDraft))
                } label: {
                    Label("Save", systemImage: "checkmark")
                }
                .buttonStyle(.borderedProminent)
                .disabled(Int(minutesDraft) == goalMinutes)
            }
        }
        .padding()
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
    }

    private func saveGoal(_ minutes: Int) {
        if let existing = goals.first {
            existing.minutesPerDay = Int32(minutes)
        } else {
            let g = DailyGoalEntity(context: ctx)
            g.id = UUID()
            g.minutesPerDay = Int32(minutes)
            g.effectiveFrom = Date()
        }
        try? ctx.save()
        WidgetSync.refresh(context: ctx)
    }
}

struct GoalsView_Previews: PreviewProvider {
    static var previews: some View {
        GoalsView()
            .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
    }
}
