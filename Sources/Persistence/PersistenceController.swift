import CoreData

final class PersistenceController: ObservableObject {
    static let shared = PersistenceController()

    static let preview: PersistenceController = {
        let controller = PersistenceController(inMemory: true)
        SampleData.populate(into: controller.container.viewContext)
        return controller
    }()

    let container: NSPersistentContainer

    init(inMemory: Bool = false) {
        container = NSPersistentContainer(name: "Paged")
        if inMemory {
            container.persistentStoreDescriptions.first?.url = URL(fileURLWithPath: "/dev/null")
        }
        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
        container.viewContext.automaticallyMergesChangesFromParent = true
        container.loadPersistentStores { _, error in
            if let error {
                assertionFailure("Failed to load Core Data: \(error)")
            }
        }
        seedSampleDataIfRequested()
    }

    private func seedSampleDataIfRequested() {
        guard UserDefaults.standard.bool(forKey: "SeedSampleData") else { return }
        let ctx = container.viewContext
        let req = NSFetchRequest<NSFetchRequestResult>(entityName: "Book")
        let count = (try? ctx.count(for: req)) ?? 0
        guard count == 0 else { return }
        SampleData.populate(into: ctx)
    }

    func save() {
        let ctx = container.viewContext
        guard ctx.hasChanges else { return }
        do { try ctx.save() } catch {
            assertionFailure("Core Data save failed: \(error)")
        }
    }
}
