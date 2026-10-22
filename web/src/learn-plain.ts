import type { Now, Plain } from './learn.ts'
import { memGB, num, pct, temp, watts } from './format.ts'
import { allCoreAvg, clusterAvg, largestModel, peakBandwidth, recentAvg, socW, usedBytes } from './story.ts'
import { busy, mediaOf } from './inside.ts'

// The plain-language version of every topic: short sentences, everyday comparisons, no unexplained jargon.
// The same comparisons everywhere: CPU cores are Fast Workers (P) and Eco Workers (E), memory (RAM) is
// Desk Space, memory bandwidth is Highway Speed, and swap is Overflow Storage.
// Facts here must match the technical version in learn.ts, which carries the sources.

export const PLAIN: Record<string, Plain> = {
  soc: {
    summary: 'Almost everything that makes your Mac think lives on one small chip. The picture zooms in on it and lights up the parts that are working.',
    sections: [
      {
        h: 'One chip, many teams',
        p: [
          'Think of the chip as one office building. The Fast Workers and Eco Workers (the CPU) handle everyday tasks. The graphics team (the GPU) draws the screen. A small AI team (the Neural Engine) handles things like recognising faces in photos. Other rooms handle video, security and the storage drive.',
          'Because they all share one building, they can pass work to each other quickly and without wasting energy.',
        ],
      },
      {
        h: 'The catch',
        p: ['Everything is built in at the factory. You cannot add more Desk Space (memory) or a faster graphics team later, so the Mac you buy is the Mac you keep.'],
      },
      {
        h: 'Your M5',
        p: ['The M5 has 4 Fast Workers, 6 Eco Workers, 8 or 10 graphics cores and a 16-core AI team. The drawing is a good guess at the layout, because Apple has not published a labelled photo of the chip.'],
      },
    ],
  },
  'p-cores': {
    summary: 'The Fast Workers. They finish big jobs quickly, but they use a lot of energy while they work, so the Mac lets them rest whenever it can.',
    sections: [
      {
        h: 'What they do',
        p: ['When you open an app, export a video or build a project, the Fast Workers jump in. They can juggle hundreds of small steps at once, which is why one task finishes fast.'],
      },
      {
        h: 'Why they rest so much',
        p: [
          'Running fast costs a lot more energy than running slowly. Most of the day the Mac is doing small chores that the Eco Workers can handle. So the Fast Workers wake for a burst, then go back to sleep.',
          'That is why you see them jump to 100% for a moment and then drop to almost nothing.',
        ],
      },
      {
        h: 'Names',
        p: ['Apple calls them super cores on the M5 MacBook Air. This app calls them P, for performance.'],
      },
    ],
  },
  'e-cores': {
    summary: 'The Eco Workers. They are smaller and slower than the Fast Workers, but they use far less energy, so they do most of the background chores.',
    sections: [
      {
        h: 'What they do',
        p: ['Searching your files for Spotlight, backing up, syncing photos to iCloud: these chores go to the Eco Workers. Nobody is waiting on them, so slow and cheap is fine.'],
      },
      {
        h: 'Reading the number',
        p: ['An Eco Worker at 100% gets less done than a Fast Worker at 100%. The percentage says how much of the time they were busy, not how much work they finished.'],
      },
    ],
  },
  scheduling: {
    summary: 'Every piece of work comes with a label that says how urgent it is. macOS reads that label to decide whether a Fast Worker or an Eco Worker should do it.',
    sections: [
      {
        h: 'The urgency labels',
        p: [
          [
            'Right now: drawing the screen and reacting to your clicks.',
            'Soon: something you asked for and are waiting on, like opening a document.',
            'Whenever: long jobs with a progress bar, like a download.',
            'In the background: chores you never asked for, like indexing and backups.',
          ],
        ],
      },
      {
        h: 'Who gets what',
        p: [
          'Background chores go to the Eco Workers only, even if every Fast Worker is sitting idle. That keeps the Mac feeling quick while chores run, and it saves battery. It is also why a backup can take a while.',
          'Urgent work goes to the Fast Workers first and spills over to the Eco Workers when the Fast Workers are all busy.',
        ],
      },
      {
        h: 'Try it',
        p: ['Watch the Last 60 seconds strips in the Chip panel while Spotlight or a backup runs. The Eco rows light up and the Fast rows stay dark.'],
      },
    ],
  },
  'cpu-usage': {
    summary: 'How busy the workers were in the last second. 20% means that, on average, each worker was busy one fifth of the time.',
    sections: [
      {
        h: 'How it is counted',
        p: ['Once a second the reader asks how much of that second each worker spent working and how much it spent waiting. The rail shows the average over all ten workers.'],
      },
      {
        h: 'Busy is not the same as hard work',
        p: ['A worker can be busy at a slow pace or busy at full speed. Look at the clock speed and power next to the percentage to see how hard the chip is really working.'],
      },
      {
        h: 'App percentages',
        p: ['In the process lists, 100% means one full worker. An app keeping four workers busy shows 400%.'],
      },
    ],
  },
  dvfs: {
    summary: 'The workers change their pace many times a second. Going slower lets the chip use a lower voltage, which saves a lot of energy.',
    sections: [
      {
        h: 'Like a car in a low gear',
        p: [
          'Driving at 50 instead of 100 does not just halve the fuel; it saves much more. Chips work the same way. The top speeds cost far more energy than the middle ones.',
          'So the chip picks from a fixed list of speed steps, moment to moment: just fast enough to get the work done.',
        ],
      },
      {
        h: 'Why speed drops in long jobs',
        p: ['On a long export the Air slowly warms up. It has no fan, so to stay cool it picks slower steps. Watch the clock in the Chip panel: it starts high and settles lower.'],
      },
    ],
  },
  gpu: {
    summary: 'The graphics team. It draws everything on screen, runs games, and does most of the maths when you run an AI chat model on your Mac.',
    sections: [
      {
        h: 'Many small hands',
        p: ['The CPU is a few clever workers. The GPU is a crowd of simpler ones that all do the same step at the same time. That is perfect for pixels, where the same small job repeats millions of times.'],
      },
      {
        h: 'Sharing the desk',
        p: ['On many PCs the graphics card has its own separate memory, and data has to be copied over. On your Mac the graphics team works from the same Desk Space as everyone else, so nothing needs copying.'],
      },
      {
        h: 'Reading the number',
        p: ['GPU usage is how much of the last second the graphics team was awake. A light animation can keep it awake a lot while it barely works, so look at its power too.'],
      },
    ],
  },
  'neural-engine': {
    summary: 'A small specialist team for AI. It is very good at one kind of maths and uses little energy doing it. macOS uses it for things like recognising what is in your photos.',
    sections: [
      {
        h: 'What it is good at',
        p: ['AI models are mostly huge multiplication tables. The Neural Engine does exactly that, at low precision, very efficiently. It cannot do anything else.'],
      },
      {
        h: 'Who uses it',
        p: [
          "Apps cannot boss it around directly. They hand a model to Apple's Core ML, which decides which parts go to the Neural Engine, the graphics team or the CPU.",
          'Chat apps like Ollama and LM Studio run on the graphics team instead, so the Neural Engine stays quiet while they talk.',
        ],
      },
      {
        h: 'On this page',
        p: ['macOS does not say how busy it is, only how much power it uses. So the block glows with its power.'],
      },
    ],
  },
  'system-cache': {
    summary: 'A shared shelf in the middle of the chip. When one team puts something on it, another team can pick it up without walking all the way to memory.',
    sections: [
      {
        h: 'Why a shelf helps',
        p: ['Fetching from memory is like walking to the storeroom. The shelf is right there. Every trip it saves makes the chip faster and saves energy.'],
      },
      {
        h: 'On this page',
        p: ['There is no reading for it, so the block is drawn dim and still.'],
      },
    ],
  },
  'media-engine': {
    summary: 'A video specialist. It plays and records video with very little effort, so watching a film barely touches the workers.',
    sections: [
      {
        h: 'Why it exists',
        p: ['Video means doing the same heavy steps for every single frame. A dedicated machine for that job uses far less battery than asking the workers to do it.'],
      },
      {
        h: 'How to spot it',
        p: ['Play a video. The Decode lane in the Chip panel starts moving, because the reader can see the video specialist reading and writing Desk Space. Record or join a video call and the Encode lane moves instead.'],
      },
    ],
  },
  'video-codecs': {
    summary: 'A video is mostly not pictures. It stores a whole picture now and then, and in between it only writes down what moved.',
    sections: [
      {
        h: 'Three kinds of picture',
        p: [
          [
            'I: a whole picture, like a photo. Big.',
            'P: "same as that earlier picture, except these bits". Much smaller.',
            'B: borrows from a picture before it and one after it. The smallest of all.',
          ],
        ],
      },
      {
        h: 'Little squares and arrows',
        p: [
          'Each picture is cut into small squares. A square that did not change is just copied. A square where something moved gets an arrow saying where to copy it from, plus a tiny fix-up. Finding those arrows is hard work, which is why recording uses the video specialist.',
        ],
      },
      {
        h: 'About the drawing',
        p: ['The moving drawing with the ball is an illustration, not a reading from your Mac. The lanes above it are the live part.'],
      },
    ],
  },
  'display-engine': {
    summary: 'The part that takes each finished picture from memory and sends it to the screen, on time, many times a second.',
    sections: [
      {
        h: 'What it does',
        p: ['Apps paint their windows into memory. The display engine stacks those layers together and delivers the final picture to the screen for every refresh.'],
      },
      {
        h: 'Brightness',
        p: ['Screen brightness is a light behind the picture, not the picture itself. Dimming it saves power without the chip doing any less.'],
      },
    ],
  },
  'secure-enclave': {
    summary: 'A locked safe inside the chip. It holds your encryption keys and checks your fingerprint, and it never hands the keys to the rest of the Mac.',
    sections: [
      {
        h: 'A safe with its own guard',
        p: ['It has its own little processor and its own locked memory. macOS can ask it to do things, like "does this fingerprint match?", but it only ever gets yes or no back.'],
      },
      {
        h: 'Your files are always locked',
        p: ['Everything on the built-in drive is encrypted, all the time. Turning on FileVault adds your password to the lock, so the data is useless to anyone without both the Mac and your password.'],
      },
    ],
  },
  'io-block': {
    summary: 'The part of the chip that runs the USB-C ports and connects to other chips on the board, like the Wi-Fi.',
    sections: [
      {
        h: 'On your Air',
        p: ['The Air has two Thunderbolt 4 ports, which use the USB-C shape, and a MagSafe charging port. The ports sit on a small separate board inside the case.'],
      },
      {
        h: 'On this page',
        p: ['There is no reading for port traffic, so the block is drawn dim.'],
      },
    ],
  },
  processes: {
    summary: 'The apps and helpers using the most workers and the most Desk Space right now, updated every two seconds.',
    sections: [
      {
        h: 'Worker time',
        p: ['For each app, the reader checks how much worker time it used in the last two seconds. 100% means one full worker.'],
      },
      {
        h: 'Desk Space',
        p: ['Memory is the same number Activity Monitor shows in its Memory column: the Desk Space the app has actually filled with its own work.'],
      },
      {
        h: 'What is missing',
        p: ['The reader runs as you, so it can only look at your own apps. System parts like WindowServer do not appear. Apps with many helpers of the same name are added up into one row.'],
      },
    ],
  },
  'unified-memory': {
    summary: 'Memory is your Mac\'s Desk Space: where it keeps everything it is working on right now. Every part of the chip shares the same desk.',
    sections: [
      {
        h: 'One desk for everyone',
        p: ['On many PCs, the graphics card has its own small desk, and things get copied back and forth. On your Mac the workers, the graphics team and the AI team all share one big desk, so nothing gets copied.'],
      },
      {
        h: 'The catch',
        p: ['A shared desk means a shared Highway too: when the graphics team is busy fetching, everyone else waits a little longer. And the desk size is fixed when the Mac is built.'],
      },
      {
        h: 'How big',
        p: ['Your M5 can have up to 32 GB of Desk Space. The Highway Speed to it is 153 GB per second.'],
      },
    ],
  },
  'memory-interface': {
    summary: 'Highway Speed: how fast things travel between the Desk Space and the chip. For some big jobs, this is the real speed limit.',
    sections: [
      {
        h: 'The highway',
        p: [
          'Every number the chip works on has to travel from the desk to the chip and back. Apple quotes the top Highway Speed for each chip: 120 GB per second for the M4, 153 for the M5.',
          'Real traffic stays below the top speed, the same way a highway is never completely full.',
        ],
      },
      {
        h: 'What uses it',
        p: ['AI chat models use it the most, then games, video editing and big software builds. Normal use is light traffic.'],
      },
      {
        h: 'On this page',
        p: ['The particles running between the memory and the chip follow this reading. More traffic, more particles. The reading is rough, to within a few GB per second.'],
      },
    ],
  },
  'memory-kinds': {
    summary: 'Your Desk Space is split into a few kinds. Some of it is really taken, and some of it the Mac can clear in a moment if it needs room.',
    sections: [
      {
        h: 'The kinds',
        p: [
          [
            'Wired: things that must stay on the desk, like the core of macOS and whatever the graphics team is using.',
            'App: work your apps have spread out on the desk.',
            'Compressed: app work that has been folded up small to save room.',
            'Cached: things left on the desk in case you need them again. Easy to clear.',
            'Free: empty desk. macOS keeps this small on purpose, because an empty desk does nothing for you.',
          ],
        ],
      },
      {
        h: 'Why it looks full',
        p: ['A nearly full desk is normal and healthy. It means macOS is keeping useful things close at hand. Memory pressure tells you whether it is actually struggling.'],
      },
    ],
  },
  'memory-pressure': {
    summary: 'How hard macOS is working to find room on the Desk Space. This matters much more than how full the desk looks.',
    sections: [
      {
        h: 'What macOS does when the desk gets crowded',
        p: [
          {
            steps: [
              'Uses the empty spots first.',
              'Clears away things it kept just in case.',
              'Folds up work that has not been touched in a while (compression).',
              'Asks apps to tidy up their own piles.',
              'Moves folded work to Overflow Storage on the drive (swap).',
              'As a last resort, asks you to quit some apps.',
            ],
          },
        ],
      },
      {
        h: 'The three levels',
        p: [
          [
            'Normal (green in Activity Monitor): the desk is being used well.',
            'Warn (yellow): the Mac is working hard to make room. It might need more memory one day.',
            'Critical (red): the desk is too small for what you are doing.',
          ],
        ],
      },
    ],
  },
  compression: {
    summary: 'Before moving anything off the desk, macOS folds up idle work so it takes less room. Unfolding it later is much quicker than fetching it from Overflow Storage.',
    sections: [
      {
        h: 'Like folding clothes',
        p: ['Work an app has not touched for a while gets squeezed into a smaller pile. When the app reaches for it again, macOS unfolds it instantly and the app never notices.'],
      },
      {
        h: 'Why fold first',
        p: ['Folding takes a little effort from the workers. Sending work to Overflow Storage on the drive and fetching it back takes much longer, and it wears the drive.'],
      },
      {
        h: 'Reading the number',
        p: ['The number shows how much desk the folded piles take up now, not how big they were before.'],
      },
    ],
  },
  swap: {
    summary: 'Swap is Overflow Storage: when the desk is truly full, macOS moves folded work onto the drive and fetches it back when needed.',
    sections: [
      {
        h: 'Is it bad?',
        p: [
          'A little Overflow Storage is normal and can sit there for hours without causing trouble.',
          'If it keeps growing while you work and memory pressure is yellow or red, your work needs more Desk Space than the Mac has. Things slow down, because every trip to Overflow Storage takes time.',
        ],
      },
      {
        h: 'Is it safe?',
        p: ['Yes. Overflow Storage is encrypted, and everything moved there is folded up first, so it moves less data than you might think.'],
      },
    ],
  },
  'llm-bandwidth': {
    summary: 'An AI chat model has to read its whole "brain" from the desk for every single word it writes. So its speed is limited by Highway Speed, not by how many workers you have.',
    sections: [
      {
        h: 'The simple sum',
        p: [
          'To write each word (a token), the model reads all of its weights once. So the best possible speed is Highway Speed divided by the model size.',
          'Example: a 4.7 GB model on an M5 with a 153 GB per second highway can write at most about 33 words per second.',
        ],
      },
      {
        h: 'Real life',
        p: [
          'Real speed is lower, around three quarters of that limit, because the highway is never perfectly full and the model also rereads the conversation so far.',
          'Proof that the highway is the limit: an M3 with 10 graphics cores writes no faster than an M2 with 8, because both have the same Highway Speed.',
        ],
      },
      {
        h: 'What helps',
        p: ['A smaller model, or a squeezed (quantised) version of the same model, means less to read per word, so it runs faster.'],
      },
    ],
  },
  ssd: {
    summary: 'The drive where your files live when the Mac is off. The memory chips only hold the data; the part that manages them is inside the main chip.',
    sections: [
      {
        h: 'How it works',
        p: [
          'Think of a filing cabinet. The drawers (flash memory chips) sit on the board, and the clerk who runs them lives inside the main chip. The clerk also locks every file as it goes in.',
          'Flash wears out a little each time it is rewritten, so the clerk spreads the writing around and cleans up old space when the Mac is idle.',
        ],
      },
      {
        h: 'Reading the numbers',
        p: ['Read and write speeds include any external drives. A file the Mac already has on the desk does not count, which is why opening the same big file twice is faster the second time.'],
      },
    ],
  },
  power: {
    summary: 'Where your Mac\'s energy goes, in watts. The chip reports what its parts use, a sensor reports the whole Mac, and the gap is everything else.',
    sections: [
      {
        h: 'Chip and the rest',
        p: [
          'Chip power is the workers, the graphics team and the AI team. At idle that can be under a watt.',
          'The rest is the screen light, the drive, Wi-Fi, memory and the small losses in turning battery power into the right voltages. On an idle Air the rest is often bigger than the chip.',
        ],
      },
      {
        h: 'Try it',
        p: ['Dim the screen and watch total power fall while chip power stays the same.'],
      },
    ],
  },
  'power-delivery': {
    summary: 'Small power chips turn the battery or charger power into the many low voltages the chip and memory need.',
    sections: [
      {
        h: 'Like a fuse box',
        p: ['The chip does not run on one voltage. Each team gets its own supply, set as low as it can go. When a team needs to go faster, its voltage goes up first.'],
      },
      {
        h: 'Charging',
        p: ['A charging chip decides how much charger power goes into the battery. It slows or pauses charging to protect the battery.'],
      },
    ],
  },
  temperatures: {
    summary: 'How warm the chip is, from sensors built into it. The number is an average, so small hot spots can be warmer.',
    sections: [
      {
        h: 'What is normal',
        p: [
          'Apple does not publish limits. On a fanless Air the chip gets much warmer under a long job than at rest, and that is expected.',
          'What matters is the thermal state and whether the speed drops, not the exact number.',
        ],
      },
    ],
  },
  'thermal-state': {
    summary: 'macOS\'s own one-word answer to "how hot is it?": nominal, fair, serious or critical.',
    sections: [
      {
        h: 'The four words',
        p: [
          [
            'Nominal: all normal.',
            'Fair: a bit warm.',
            'Serious: hot. The Mac slows down a little to cool off.',
            'Critical: very hot. The Mac slows down a lot until it cools.',
          ],
        ],
      },
      {
        h: 'On a fanless Air',
        p: ['The Air cannot spin up a fan, so slowing down is its only way to cool. Fair during a long export is normal.'],
      },
    ],
  },
  cooling: {
    summary: 'The MacBook Air has no fan. Heat spreads from the chip into the aluminium case, and the case passes it to the air around it.',
    sections: [
      {
        h: 'The case is the radiator',
        p: ['A thin metal cover over the board spreads the heat out, and the whole aluminium body slowly warms up and lets it go. It is silent because nothing moves.'],
      },
      {
        h: 'Short bursts versus long jobs',
        p: ['The case can soak up a lot of heat before it gets warm, so short jobs run at full speed. On a long job the case fills up, and the chip slows down until it makes heat no faster than the case can shed it.'],
      },
    ],
  },
  battery: {
    summary: 'The battery wraps around the trackpad in four flat cells. A small gauge chip keeps track of how full and how healthy it is.',
    sections: [
      {
        h: 'The percentage',
        p: ['The gauge measures the power going in and out and estimates how much is left. The percentage is compared with what the battery can hold today, not when it was new.'],
      },
      {
        h: 'Heat is the enemy',
        p: ['Batteries age faster when hot, and faster still when hot and full. Apple suggests keeping your Mac in a room between 16 and 22 °C, and warns that above 35 °C the battery can be damaged for good.'],
      },
    ],
  },
  'battery-health': {
    summary: 'How much the battery can hold now, compared with when it was new. 100% means as good as new.',
    sections: [
      {
        h: 'Why it drops',
        p: ['Every charge wears the battery a tiny bit. Heat and sitting at 100% for long periods wear it faster.'],
      },
      {
        h: "Apple's promise",
        p: ['Apple designs MacBook Air batteries to keep up to 80% of their capacity after 1000 charge cycles. A new battery can even read a little over 100%.'],
      },
    ],
  },
  cycles: {
    summary: 'One cycle is using a full battery\'s worth of energy, even if it is spread over several days.',
    sections: [
      {
        h: 'Counting',
        p: ['Use half the battery today and half tomorrow, and that is one cycle, not two. Topping up often is fine.'],
      },
      {
        h: 'How many',
        p: ['Apple rates every Apple silicon MacBook Air for 1000 cycles. After that the battery still works; it just holds less.'],
      },
    ],
  },
  'charge-held': {
    summary: 'Your Mac is plugged in but not charging, below 100%. Usually macOS is doing this on purpose to protect the battery, and the Mac runs straight from the charger.',
    sections: [
      {
        h: 'Why it holds',
        p: [
          [
            'Optimized Battery Charging: if macOS expects you to stay plugged in for a long time, it waits at 80%.',
            'Charge Limit: on newer macOS you can choose a maximum between 80% and 100%.',
            'A short rest: charging can pause and let the battery drift down to about 90% first.',
            'Heat: if the battery is warm, charging may stop at 80% until it cools.',
          ],
        ],
      },
      {
        h: 'One exception',
        p: ['A charger that is too small for what you are doing can also stop charging. Then the battery slowly drains even while plugged in. Battery flow tells you which it is: about 0 W means held on purpose.'],
      },
    ],
  },
  'battery-flow': {
    summary: 'How much power is going into the battery or coming out of it right now, in watts.',
    sections: [
      {
        h: 'Reading it',
        p: ['Plus means charging. Minus means the battery is running the Mac. Close to zero means the charger is running the Mac and the battery is resting.'],
      },
      {
        h: 'Try it',
        p: ['On battery, dim the screen and watch the drain drop. Start a big job and watch it rise.'],
      },
    ],
  },
  adapter: {
    summary: 'How many watts your charger can supply, as agreed with the Mac when you plugged it in.',
    sections: [
      {
        h: 'The handshake',
        p: ['When you plug in a USB-C charger, it tells the Mac what it can deliver and the Mac picks a setting. The number is the charger\'s rating, not what the Mac is using right now.'],
      },
      {
        h: 'Too small?',
        p: ['A small charger is fine for light work. Under a heavy load the battery tops up the difference, so it may charge slowly or even drain.'],
      },
    ],
  },
  wifi: {
    summary: 'Wi-Fi and Bluetooth come from a separate radio chip. Its antennas sit near the hinge, because the metal case blocks radio signals.',
    sections: [
      {
        h: 'The radio',
        p: ["The M5 Air uses Apple's own N1 radio chip for Wi-Fi 7 and Bluetooth 6."],
      },
      {
        h: 'On this page',
        p: ['Network traffic is drawn flowing toward the hinge, where the antennas are. The rate covers Wi-Fi or a wired adapter, not Bluetooth.'],
      },
    ],
  },
  'network-rates': {
    summary: 'How much data your Mac is downloading and uploading each second.',
    sections: [
      {
        h: 'How it is counted',
        p: ['Every network connection keeps a running total of bytes in and out. The reader checks the totals once a second and shows the change. Usually that is the Wi-Fi.'],
      },
      {
        h: 'Small print',
        p: ['VPN traffic is not counted twice. Very small rates move in steps of about 1 KB per second, because macOS rounds the totals for privacy.'],
      },
    ],
  },
  sensors: {
    summary: 'The lid angle, whether the camera or microphone is on, whether sound is playing, screen and keyboard brightness, and where your fingers are on the trackpad.',
    sections: [
      {
        h: 'Privacy',
        p: [
          'The reader only asks yes or no questions, like "is some app using the camera?". It never sees images, hears sound or reads what you type.',
          'Nothing here needs your permission, and finger positions are never saved.',
        ],
      },
      {
        h: 'Small print',
        p: ['Some of these use hidden parts of macOS that an update could change. If one stops working, it shows n/a instead of a wrong value.'],
      },
    ],
  },
  'lid-angle': {
    summary: 'A sensor in the hinge knows exactly how far your screen is open. The screen in the drawing tilts to match.',
    sections: [
      {
        h: 'What it is',
        p: ['Older MacBooks only knew open or closed. Newer ones measure the angle in degrees. macOS has no official way for apps to read it, so the reader uses a method a developer discovered.'],
      },
      {
        h: 'Try it',
        p: ['Move your screen and watch the drawing follow.'],
      },
    ],
  },
  'camera-mic': {
    summary: 'Whether any app is using the camera or microphone, and whether sound is playing. The reader asks macOS; it never opens the camera or microphone itself.',
    sections: [
      {
        h: "macOS's own warning lights",
        p: ['macOS shows a dot in the menu bar: orange for the microphone, green for the camera. Open Control Center to see which app is using them.'],
      },
      {
        h: 'Small print',
        p: ['Only the built-in camera is watched. Some apps keep the speakers "open" even when silent, so audio can read as playing.'],
      },
    ],
  },
  'display-brightness': {
    summary: 'How bright your screen is, from 0 to 100%. The screen light is one of the biggest energy users on an idle laptop.',
    sections: [
      {
        h: 'Try it',
        p: ['Open the Power panel and press the brightness keys. Total power changes with each press while the chip stays the same.'],
      },
    ],
  },
  'keyboard-light': {
    summary: 'How bright the keyboard light is, from 0 to 100%.',
    sections: [
      {
        h: 'How it behaves',
        p: ['You set it with the keys or in System Settings. macOS can also adjust it in dim rooms, using a light sensor near the camera, and switch it off when you stop typing for a while.'],
      },
    ],
  },
  trackpad: {
    summary: 'The trackpad senses each finger through the glass and feels how hard you press. The drawing shows your fingers on it live.',
    sections: [
      {
        h: 'The click is fake',
        p: ['The trackpad does not really click. Sensors feel how hard you press, and a small magnet motor taps the glass so it feels like a click.'],
      },
      {
        h: 'Privacy',
        p: ['The reader only gets where your fingers are. No clicks, no gestures, no typing, and nothing is saved.'],
      },
    ],
  },
  reader: {
    summary: 'A small program on your Mac reads its sensors once a second and sends the numbers to this page.',
    sections: [
      {
        h: 'Stays on your Mac',
        p: ['It only talks to this page on your own Mac. Nothing goes to the internet, and it needs no password or permission.'],
      },
      {
        h: 'Honest about gaps',
        p: ['If it cannot read something on your Mac, the page says n/a instead of showing a fake zero.'],
      },
      {
        h: 'Demo data',
        p: ['Without the program running, the page plays made-up data and says Demo data at the top.'],
      },
    ],
  },
  ioreport: {
    summary: 'A hidden part of macOS where the chip reports its energy use, speed and memory traffic. The reader reads it to show power and clock speeds.',
    sections: [
      {
        h: 'Like a meter cupboard',
        p: ['Each part of the chip keeps its own meters. The reader takes a look, waits a second, looks again, and works out the difference.'],
      },
      {
        h: 'Why some values say n/a',
        p: ['Apple does not document these meters and changes them between macOS versions. When a meter stops working, the page shows n/a rather than a wrong number.'],
      },
    ],
  },
  smc: {
    summary: 'A small helper inside the chip that watches temperatures, power, the battery and the lid. The reader asks it for temperatures and total power.',
    sections: [
      {
        h: 'What it does',
        p: ['It keeps running even when the Mac sleeps. It answers questions by short four-letter codes, like PSTR for total power.'],
      },
      {
        h: 'Unwritten rules',
        p: ['Apple does not publish what the codes mean. People worked them out by testing, so they may change on a new chip.'],
      },
    ],
  },
  sysctl: {
    summary: 'macOS keeps a list of facts about your Mac, like its model, its chip and how much memory it has. The reader looks them up there.',
    sections: [
      {
        h: 'Try it',
        p: ['Open Terminal and type `sysctl hw.memsize` to see your memory size in bytes, or `vm_stat` to see how the Desk Space is split up.'],
      },
    ],
  },
  iokit: {
    summary: 'A live map of every part inside your Mac, from the battery to the graphics team. Many facts on this page are labels on that map.',
    sections: [
      {
        h: 'What the reader finds there',
        p: ['The battery\'s charge and health, how much the drive has read and written, how many graphics cores there are, and which workers are Fast and which are Eco.'],
      },
      {
        h: 'Try it',
        p: ['Type `ioreg -rc AppleSmartBattery` in Terminal to see the battery facts the reader uses.'],
      },
    ],
  },
  story: {
    summary: 'The "What\'s happening" card guesses what your Mac is busy with from the last five seconds of numbers. It is an educated guess, not mind reading.',
    sections: [
      {
        h: 'The guesses, in order',
        p: [
          [
            'An AI chat model is writing: Ollama or LM Studio is running and the graphics team is busy.',
            'Heavy work: the Fast Workers are busy.',
            'Graphics work: the graphics team is busy while the workers are calm.',
            'Background chores: the Eco Workers are busy and the Fast Workers rest.',
            'Mostly idle: everyone is calm.',
            'Mixed load: anything else.',
          ],
        ],
      },
      {
        h: 'Why it does not flicker',
        p: ['It looks at the middle value of the last five seconds, so one short spike does not change the card.'],
      },
    ],
  },
  layout: {
    summary: 'The exploded drawing is a 13-inch MacBook Air pulled apart into layers, based on repair-shop teardown photos.',
    sections: [
      {
        h: 'How close is it?',
        p: ['Nobody has published a teardown of the M5 Air yet. It uses the same body as the M2 Air, so the parts are placed from M2 and M4 teardowns. Positions are good guesses.'],
      },
      {
        h: 'What moves',
        p: ['Particles follow memory, drive and network traffic. The speakers pulse with sound, the screen tilts with your real lid, and the trackpad shows your fingers. The chip is drawn bigger than life so you can see the workers.'],
      },
    ],
  },
  'audio-path': {
    summary: 'Sound leaves your Mac through four small speakers hidden along the hinge, and comes in through three tiny microphones at the left end of it.',
    sections: [
      {
        h: 'Sound going out',
        p: [
          {
            steps: [
              'An app hands over sound as a long list of numbers, about 48,000 a second.',
              'The sound mixer in macOS adds every app together and sets the volume.',
              'Small amplifier chips turn the numbers into electricity strong enough to move a speaker.',
              'Four speakers under the case push the sound out through the thin gap below the screen. That is why there are no speaker holes.',
            ],
          },
        ],
      },
      {
        h: 'Sound coming in',
        p: [
          'Three microphones all hear the whole room. By comparing tiny differences in when a sound reaches each one, the Mac can listen mostly in the direction of your face and turn down the rest.',
          'When you close the lid, the microphones are switched off in the hardware itself, so nothing can listen.',
        ],
      },
      {
        h: 'What this app sees',
        p: ['Only whether sound is playing and whether some app is listening. Never the sound itself.'],
      },
    ],
  },
  'camera-path': {
    summary: 'The camera in the notch sends what it sees down through the hinge to a photo cleanup part of the main chip, which hands clean pictures to your app. The green light comes on every time.',
    sections: [
      {
        h: 'From light to your call',
        p: [
          {
            steps: [
              'Light hits a 12 megapixel sensor behind the lens.',
              'The raw picture goes to the photo cleanup part of the chip, which fixes colour, brightness and noise.',
              'Clean pictures go onto the Desk Space, where the app can use them right away.',
            ],
          },
        ],
      },
      {
        h: 'The green light',
        p: ['Apple builds the camera so it cannot turn on without the green light. If the light is off, the camera is off.'],
      },
      {
        h: 'The light sensor next to it',
        p: ['A tiny light sensor sits beside the camera and sets the screen brightness for the room. A camera cover blocks it too, which is one reason Apple says not to use one.'],
      },
    ],
  },
}

// "Right now" lines in everyday words, for the topics whose technical line uses jargon (P-cores, MHz, pressure).
// The explainer shows these when the everyday variant is on; every other topic keeps its own line.
const workers = (u: number | null) => (u == null ? 'not reported' : `${pct(u)} busy`)
export const PLAIN_NOW: Record<string, (x: Now) => string | null> = {
  soc: ({ hw, s }) => {
    const w = socW(s)
    return `Your ${hw.chip} has ${hw.pCores} Fast Workers, ${hw.eCores} Eco Workers and ${hw.gpuCores ?? 'an unknown number of'} graphics cores. ${w == null ? 'This Mac does not say how much energy the chip uses.' : `Together they are using ${watts(w)} right now.`}`
  },
  'p-cores': ({ hw, s }) => {
    const p = clusterAvg(s, 'P')
    if (p == null) return 'This Mac reports no Fast Workers.'
    return `Your ${hw.pCores} Fast Workers are ${pct(p)} busy. ${p < 0.1 ? 'They are resting, which is normal when nothing big is running.' : p > 0.7 ? 'They are working hard on a big job.' : 'They are jumping in for short bursts.'}`
  },
  'e-cores': ({ hw, s }) => {
    const e = clusterAvg(s, 'E')
    return e == null ? 'This Mac reports no Eco Workers.' : `Your ${hw.eCores} Eco Workers are ${pct(e)} busy with background chores.`
  },
  scheduling: ({ s }) => `Fast Workers ${workers(clusterAvg(s, 'P'))}, Eco Workers ${workers(clusterAvg(s, 'E'))}.`,
  'cpu-usage': ({ s }) => `On average the workers are ${workers(allCoreAvg(s))}: Fast Workers ${workers(clusterAvg(s, 'P'))}, Eco Workers ${workers(clusterAvg(s, 'E'))}.`,
  dvfs: ({ s }) => {
    const p = s.cpu.pFreqMHz
    const e = s.cpu.eFreqMHz
    if (p == null && e == null) return 'This Mac does not say how fast the workers are running.'
    return `The Fast Workers are running at ${p == null ? 'an unknown speed' : `${num(p / 1000, 1)} billion steps a second`}, the Eco Workers at ${e == null ? 'an unknown speed' : `${num(e / 1000, 1)} billion`}. Slower means far less energy.`
  },
  gpu: ({ s }) => (s.gpu.usage == null ? 'This Mac does not say how busy the graphics part is.' : `The graphics part was drawing ${pct(s.gpu.usage)} of the last second.`),
  'neural-engine': ({ s }) => {
    const w = s.power.aneW
    return w == null ? 'This Mac does not say whether the AI team is working.' : w < 0.05 ? 'The AI team is resting.' : `The AI team is working, using ${watts(w)}.`
  },
  'unified-memory': ({ s }) => `${memGB(usedBytes(s))} of your ${memGB(s.memory.totalBytes, 0)} of Desk Space is in use${s.memory.pressure === 'normal' ? '.' : ', and it is getting crowded.'}`,
  'memory-interface': ({ hw, s }) => {
    const bw = s.memory.bandwidthGBs
    if (bw == null) return 'This Mac does not say how fast data is moving on the Highway.'
    const peak = peakBandwidth(hw.chip)
    return `Data is moving at ${num(bw)} GB/s on the Highway${peak ? `, ${pct(bw / peak)} of its top Highway Speed` : ''}.`
  },
  'memory-kinds': ({ s }) => {
    const m = s.memory
    return `${memGB(m.appBytes ?? m.activeBytes)} for apps, ${memGB(m.wiredBytes)} kept for macOS itself, ${memGB(m.inactiveBytes)} of recent files kept handy, ${memGB(m.freeBytes)} empty.`
  },
  'memory-pressure': ({ s }) =>
    s.memory.pressure === 'normal'
      ? 'There is plenty of Desk Space right now.'
      : s.memory.pressure === 'warn'
        ? 'Desk Space is getting tight, so macOS is squeezing things to make room.'
        : 'Desk Space is full, and things are spilling into Overflow Storage.',
  compression: ({ s }) => (s.memory.compressedBytes > 0 ? `${memGB(s.memory.compressedBytes)} of Desk Space holds squeezed-up pages.` : 'Nothing is squeezed right now.'),
  swap: ({ s }) => (s.memory.swapUsedBytes > 0 ? `${memGB(s.memory.swapUsedBytes)} has spilled into Overflow Storage.` : 'Nothing is in Overflow Storage right now.'),
  'llm-bandwidth': ({ hw, s }) => {
    const peak = peakBandwidth(hw.chip)
    const m = largestModel(s)
    if (peak == null || !m?.bytes) return null
    return `Highway Speed ${peak} GB/s ÷ a ${num(m.bytes / 1e9, 1)} GB model ≈ ${num(peak / (m.bytes / 1e9))} words a second at most.`
  },
  power: ({ s, history }) => {
    const chip = socW(s)
    const sys = recentAvg(history, (x) => x.power.systemW)
    if (chip == null && sys == null) return 'This Mac does not say how much energy it uses.'
    return chip == null ? `The whole Mac is using ${watts(sys)}.` : `The chip is using ${watts(chip)}${sys == null ? '.' : `, out of ${watts(sys)} for the whole Mac.`}`
  },
  temperatures: ({ s }) => `The chip is at ${temp(s.thermal.cpuTempC)}, and macOS calls that ${s.thermal.state === 'nominal' ? 'normal' : s.thermal.state}.`,
  'media-engine': ({ s }) => {
    const m = mediaOf(s)
    if (m.decodeGBs == null && m.encodeGBs == null) return 'This reader cannot see the video specialist.'
    const d = busy(m.decodeGBs)
    const e = busy(m.encodeGBs)
    return d && e ? 'The video specialist is unsqueezing and squeezing video at the same time.' : d ? 'The video specialist is unsqueezing a video for you to watch.' : e ? 'The video specialist is squeezing video, for a call or a recording.' : 'The video specialist is resting.'
  },
}
