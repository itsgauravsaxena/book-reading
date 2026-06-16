import CoreData
import SwiftUI

struct RootView: View {
    @Environment(\.managedObjectContext) private var ctx
    @State private var selection: Tab = Tab(rawValue: UserDefaults.standard.string(forKey: "StartTab") ?? "") ?? .library
    @State private var devManualBook: BookEntity?

    enum Tab: String { case library, stats, goal }

    var body: some View {
        TabView(selection: $selection) {
            LibraryView()
                .tabItem { Label("Library", systemImage: "books.vertical.fill") }
                .tag(Tab.library)

            StatsView()
                .tabItem { Label("Stats", systemImage: "chart.bar.fill") }
                .tag(Tab.stats)

            GoalsView()
                .tabItem { Label("Goal", systemImage: "target") }
                .tag(Tab.goal)
        }
        .tint(.accentColor)
        .onAppear {
            WidgetSync.refresh(context: ctx)
            if UserDefaults.standard.bool(forKey: "OpenManualLog") {
                let req = NSFetchRequest<BookEntity>(entityName: "Book")
                req.fetchLimit = 1
                devManualBook = (try? ctx.fetch(req))?.first
            }
        }
        .sheet(item: $devManualBook) { book in
            ManualSessionView(book: book)
                .environment(\.managedObjectContext, ctx)
        }
    }
}

struct RootView_Previews: PreviewProvider {
    static var previews: some View {
        RootView()
            .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
    }
}
