import CoreData
import WidgetKit

enum WidgetSync {
    /// Recompute today's reading minutes and current goal, push to the shared store,
    /// then ask WidgetKit to refresh.
    static func refresh(context: NSManagedObjectContext) {
        let sessionReq = NSFetchRequest<ReadingSessionEntity>(entityName: "ReadingSession")
        sessionReq.predicate = NSPredicate(format: "dayKey == %@", DayKey.today())
        let seconds = ((try? context.fetch(sessionReq)) ?? [])
            .reduce(0) { $0 + Int($1.durationSeconds) }

        let goalReq = NSFetchRequest<DailyGoalEntity>(entityName: "DailyGoal")
        goalReq.sortDescriptors = [NSSortDescriptor(key: "effectiveFrom", ascending: false)]
        goalReq.fetchLimit = 1
        let goalMinutes = Int(((try? context.fetch(goalReq)) ?? []).first?.minutesPerDay ?? 0)

        SharedStore.update(todayMinutes: seconds / 60, goalMinutes: goalMinutes)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
