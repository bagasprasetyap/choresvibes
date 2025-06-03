// src/App.tsx
import { useEffect, useState, useMemo } from 'react'
import { supabase } from './supabaseClient' // Import your Supabase client

interface Todo {
  id: number;
  task: string;
  is_completed: boolean;
  // Add other fields as necessary
}

interface Chore {
  id: number;
  name: string;
  icon_identifier: string; // This could be an icon name, class, or URL
}

interface ScheduledChore {
  name: string;
  icon: string;
  frequency: string;
  days?: string; // Optional, as daily chores might not list days
  time: string;
  raw: string; // Keep the original raw string for fallback or debugging
}

// For the new Weekly Schedule View
const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
type DayOfWeek = typeof DAYS_OF_WEEK[number];
type TimeSlot = "Morning" | "Afternoon" | "Midnight";

interface DaySchedule {
  Morning: ScheduledChore[];
  Afternoon: ScheduledChore[];
  Midnight: ScheduledChore[];
}
interface WeeklyScheduleData {
  Sunday: DaySchedule;
  Monday: DaySchedule;
  Tuesday: DaySchedule;
  Wednesday: DaySchedule;
  Thursday: DaySchedule;
  Friday: DaySchedule;
  Saturday: DaySchedule;
}

function App() {
  const [chores, setChores] = useState<Chore[]>([]);
  const [planMonths, setPlanMonths] = useState<number>(1);
  const [selectedChores, setSelectedChores] = useState<Chore[]>([]);
  const [isLoadingOrganizedPlan, setIsLoadingOrganizedPlan] = useState<boolean>(false);
  const [organizedPlanOutput, setOrganizedPlanOutput] = useState<ScheduledChore[] | string | null>(null);
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklyScheduleData | null>(null);
  const [isChoreModalOpen, setIsChoreModalOpen] = useState<boolean>(false);
  const [userClaudeApiKey, setUserClaudeApiKey] = useState<string>('');
  const [choreSearchTerm, setChoreSearchTerm] = useState<string>('');

  // Memoized filtered chores
  const filteredChores = useMemo(() => {
    if (choreSearchTerm.length < 3) {
      return chores; // Return all chores if search term is too short
    }
    return chores.filter(chore => 
      chore.name.toLowerCase().includes(choreSearchTerm.toLowerCase())
    );
  }, [chores, choreSearchTerm]);

  // Load API key from localStorage on mount
  useEffect(() => {
    const storedApiKey = localStorage.getItem('claudeApiKey');
    if (storedApiKey) {
      setUserClaudeApiKey(storedApiKey);
    }
  }, []);

  // Save API key to localStorage when it changes
  useEffect(() => {
    if (userClaudeApiKey) {
      localStorage.setItem('claudeApiKey', userClaudeApiKey);
    } else {
      // Optionally remove it if user clears the input, or leave it if you prefer last valid key to persist
      localStorage.removeItem('claudeApiKey'); 
    }
  }, [userClaudeApiKey]);

  // Helper function to format dates for Google Calendar Link
  const formatGoogleCalendarDate = (date: Date): string => {
    return date.toISOString().replace(/-|:T|\.\d{3}/g, '').substring(0, 15) + 'Z';
  };

  const generateGoogleCalendarLink = (chore: ScheduledChore, planDurationMonths: number): string => {
    const title = encodeURIComponent(`${chore.icon} ${chore.name}`);
    let details = `Chore: ${chore.name}\nFrequency: ${chore.frequency}`;
    if (chore.days) details += `\nDay(s): ${chore.days}`;
    details += `\nTime: ${chore.time}`;
    details = encodeURIComponent(details);

    // --- Simplified Date/Time Logic for First Event --- 
    // This is a very basic approach and needs significant improvement for accuracy and recurrence.
    // It aims to find the next occurrence from today.

    let startDate = new Date();
    startDate.setHours(0, 0, 0, 0); // Start of today

    // Attempt to parse time (very basic)
    let eventHour = 9; // Default to 9 AM
    const timeMatch = chore.time.match(/(\d+)(?::(\d+))?\s*(am|pm)?/i);
    if (timeMatch) {
      eventHour = parseInt(timeMatch[1], 10);
      const ampm = timeMatch[3]?.toLowerCase();
      if (ampm === 'pm' && eventHour < 12) eventHour += 12;
      if (ampm === 'am' && eventHour === 12) eventHour = 0; // Midnight
    }
    
    // Attempt to find the next valid day (very basic, prefers specific days over general frequency)
    const choreDaysLower = chore.days?.toLowerCase().split(',').map(d => d.trim()) || [];
    let dayOffset = 0;
    let eventDayFound = false;

    if (choreDaysLower.length > 0 && !chore.frequency.toLowerCase().includes('daily')) {
      const currentDayOfWeek = startDate.getDay(); // Sunday = 0, Monday = 1, ...
      const targetDaysOfWeek = DAYS_OF_WEEK.map((dayName, index) => 
        choreDaysLower.includes(dayName.toLowerCase().substring(0,3)) || choreDaysLower.includes(dayName.toLowerCase()) ? index : -1
      ).filter(d => d !== -1);

      if (targetDaysOfWeek.length > 0) {
        for (let i = 0; i < 7; i++) {
          const checkDay = (currentDayOfWeek + i) % 7;
          if (targetDaysOfWeek.includes(checkDay)) {
            dayOffset = i;
            eventDayFound = true;
            break;
          }
        }
      }
    } else if (chore.frequency.toLowerCase().includes('daily')) {
        eventDayFound = true; // Daily, so today or tomorrow is fine if time has passed
    }

    if (eventDayFound) {
        startDate.setDate(startDate.getDate() + dayOffset);
    }
    // If no specific day found and not daily, it defaults to today/next few days based on time.
    // This needs refinement for non-daily, non-specific day tasks.

    startDate.setHours(eventHour, 0, 0, 0); // Set the hour, minutes to 0

    // If the calculated start time is in the past for today, move to the next valid occurrence (e.g., next day for daily)
    if (startDate < new Date() && eventDayFound) { // only advance if a day was specifically found or it's daily
        if (chore.frequency.toLowerCase().includes('daily')) {
            startDate.setDate(startDate.getDate() + 1);
        } else if (choreDaysLower.length > 0) {
            // For weekly on specific days, advance by a week if past
            startDate.setDate(startDate.getDate() + 7); 
        }
        // For other frequencies or no specific days, this logic needs more sophistication
    }


    // Create a 1-hour event duration for simplicity
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

    const dates = `${formatGoogleCalendarDate(startDate)}/${formatGoogleCalendarDate(endDate)}`;
    
    // Recurrence: Very basic RRULE for Daily or Weekly. Others are non-recurring by this simplified logic.
    let rrule = '';
    const freqLower = chore.frequency.toLowerCase();
    if (freqLower.includes('daily')) {
      rrule = 'FREQ=DAILY';
    } else if (freqLower.includes('weekly') && choreDaysLower.length > 0) {
      // Convert day string (e.g., "Monday, Friday") to GCal BYDAY (e.g., MO,FR)
      const byDay = DAYS_OF_WEEK
        .filter(d => choreDaysLower.includes(d.toLowerCase().substring(0,3)) || choreDaysLower.includes(d.toLowerCase()))
        .map(d => d.substring(0, 2).toUpperCase())
        .join(',');
      if (byDay) rrule = `FREQ=WEEKLY;BYDAY=${byDay}`;
    }
    // Plan duration (endDate for recurrence)
    if (rrule && planDurationMonths > 0) {
        const untilDate = new Date();
        untilDate.setMonth(untilDate.getMonth() + planDurationMonths);
        rrule += `;UNTIL=${formatGoogleCalendarDate(untilDate).substring(0,8)}`; // YYYYMMDD format for UNTIL
    }

    let calendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}`;
    if (rrule) {
      calendarUrl += `&recur=RRULE:${rrule}`;
    }

    return calendarUrl;
  };

  const parseAIOutput = (rawText: string): ScheduledChore[] => {
    const lines = rawText.trim().split('\n');
    const scheduledChores: ScheduledChore[] = [];
    // Regex to capture: 1. Chore Name, 2. Icon, 3. The rest (frequency, days, time)
    const lineRegex = /^- (.*?)\s*\((.*?)\):\s*(.*)$/;

    for (const line of lines) {
      const match = line.trim().match(lineRegex);
      if (match) {
        const [, name, icon, detailsStr] = match;
        const details = detailsStr.split(',').map(d => d.trim());

        let frequency = '';
        let days: string | undefined = undefined;
        let time = '';

        if (details.length >= 2) { // Minimum: Frequency, Time
          frequency = details[0];
          time = details[details.length - 1]; // Last part is always time
          if (details.length > 2) {
            days = details.slice(1, -1).join(', '); // Parts between frequency and time are days
          }
          scheduledChores.push({ name, icon, frequency, days, time, raw: line });
        } else {
          // Line doesn't fit the expected detail format, add as raw for now or handle error
          scheduledChores.push({ name: 'Unparsed Chore', icon: '❓', frequency: 'N/A', time: 'N/A', raw: line });
        }
      } else if (line.trim()) {
        // Line doesn't match the chore format at all, add as raw or handle error
        scheduledChores.push({ name: 'Unformatted Line', icon: '⚠️', frequency: 'N/A', time: 'N/A', raw: line });
      }
    }
    return scheduledChores;
  };

  const getTimeSlot = (timeString: string): TimeSlot => {
    const lowerTime = timeString.toLowerCase();
    if (lowerTime.includes('morning')) return "Morning";
    if (lowerTime.includes('afternoon')) return "Afternoon";
    if (lowerTime.includes('evening') || lowerTime.includes('night')) return "Midnight";
    // Try to parse specific times if keywords are not present
    const timeParts = lowerTime.match(/(\d+)(?::(\d+))?\s*(am|pm)?/);
    if (timeParts) {
      let hour = parseInt(timeParts[1], 10);
      const ampm = timeParts[3];
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0; // Midnight case

      if (hour >= 5 && hour < 12) return "Morning";
      if (hour >= 12 && hour < 18) return "Afternoon";
      return "Midnight"; // Covers 6 PM onwards and early morning before 5 AM
    }
    return "Afternoon"; // Default slot if unparsable
  };

  const normalizeDays = (dayString: string | undefined, frequency: string): DayOfWeek[] => {
    if (!dayString || frequency.toLowerCase().includes('daily') || frequency.toLowerCase().includes('every day')) {
        // If frequency is daily, or dayString is empty (often for daily), return all days
        if (frequency.toLowerCase().includes('daily') || frequency.toLowerCase().includes('every day')) {
            return [...DAYS_OF_WEEK];
        }
        // If dayString is empty but not explicitly daily, it's ambiguous. Default to empty or handle as error.
        // For now, if dayString is empty, assume it means no specific days set for non-daily. This might need refinement.
        return []; 
    }
    const potentialDays = dayString.split(',').map(d => d.trim());
    return potentialDays.filter(pd => DAYS_OF_WEEK.includes(pd as DayOfWeek)) as DayOfWeek[];
  };

  const generateWeeklyScheduleData = (parsedChores: ScheduledChore[]): WeeklyScheduleData => {
    const initialDaySchedule = (): DaySchedule => ({ Morning: [], Afternoon: [], Midnight: [] });
    const newWeeklySchedule: WeeklyScheduleData = {
      Sunday: initialDaySchedule(), Monday: initialDaySchedule(), Tuesday: initialDaySchedule(), 
      Wednesday: initialDaySchedule(), Thursday: initialDaySchedule(), Friday: initialDaySchedule(), 
      Saturday: initialDaySchedule(),
    };

    parsedChores.forEach(chore => {
      if (chore.name === 'Unparsed Chore' || chore.name === 'Unformatted Line') return; // Skip unparsed

      const daysForChore = normalizeDays(chore.days, chore.frequency);
      const timeSlot = getTimeSlot(chore.time);

      daysForChore.forEach(day => {
        if (newWeeklySchedule[day] && newWeeklySchedule[day][timeSlot]) {
          newWeeklySchedule[day][timeSlot].push(chore);
        }
      });
    });
    return newWeeklySchedule;
  };

  useEffect(() => {
    fetchChores();
  }, []);

  const fetchChores = async () => {
    const { data, error } = await supabase
      .from('chores') // Your chores table name
      .select('*');

    if (error) {
      console.error('Error fetching chores:', error);
    } else if (data) {
      // Sort chores alphabetically by name before setting state
      const sortedData = data.sort((a, b) => a.name.localeCompare(b.name));
      setChores(sortedData as Chore[]); 
    }
  };

  const handleChoreSelect = (chore: Chore) => {
    setSelectedChores((prevSelected) => {
      const isSelected = prevSelected.find(sc => sc.id === chore.id);
      if (isSelected) {
        return prevSelected.filter(sc => sc.id !== chore.id); // Deselect
      } else {
        return [...prevSelected, chore]; // Select
      }
    });
  };

  const handleClearSelectedChores = () => {
    setSelectedChores([]);
  };

  const handleOrganizeChores = async () => {
    if (selectedChores.length === 0) return;

    const apiKeyToUse = userClaudeApiKey || import.meta.env.VITE_CLAUDE_API_KEY;

    if (!apiKeyToUse) {
      console.error("Claude API Key is not configured. Please enter your key or check .env file.");
      setOrganizedPlanOutput("Error: Claude API Key is missing. Please enter your API key above.");
      setWeeklySchedule(null);
      setIsLoadingOrganizedPlan(false);
      return;
    }

    setIsLoadingOrganizedPlan(true);
    setOrganizedPlanOutput(null);
    setWeeklySchedule(null); // Clear previous weekly schedule

    const choresListString = selectedChores.map(chore => `- ${chore.name} (${chore.icon_identifier})`).join('\n');
    const userPrompt = `
I need to create a cleaning schedule for the following chores over the next ${planMonths} month(s):
${choresListString}

Please generate a schedule for these chores.
For each chore, suggest:
1. Frequency (e.g., Daily, Twice a week, Weekly, Bi-weekly, Monthly).
2. Specific day(s) of the week if applicable (e.g., Monday, Wednesday, Saturday).
3. Time of day if relevant (e.g., Morning, Afternoon, Evening, or a specific time like 9:00 AM).

Present the schedule **only as a list**, with each chore and its schedule on a new line.
Use the following format for each item:
- [Chore Name] ([Icon]): [Frequency], [Day(s) if not daily], [Time of Day]

For example:
- Dishwashing (🧼): Daily, Evening
- Laundry (🧺): Weekly, Saturday, Morning
- Vacuuming (💨): Twice a week, Wednesday, Friday, Afternoon
- Grocery Shopping (🛒): Weekly, Sunday, 10:00 AM

Please only provide the list of chores and their schedules in this format. Do not include any introductory or concluding sentences.
    `;
    const systemPrompt = "You are a helpful assistant that specializes in creating clear, concise, and practical chore schedules. Output only the requested list in the specified format.";

    try {
      const response = await fetch('/api/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKeyToUse,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-3-7-sonnet-latest', 
          max_tokens: 1500,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Claude API Error:', errorData);
        setOrganizedPlanOutput(`Claude API Error: ${response.status} ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`);
        setWeeklySchedule(null);
        throw new Error(`Claude API Error: ${response.status} ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      if (data.content && data.content.length > 0 && data.content[0].type === 'text') {
        const parsedChores = parseAIOutput(data.content[0].text);
        if (parsedChores.some(c => c.name !== 'Unparsed Chore' && c.name !== 'Unformatted Line')) {
            setOrganizedPlanOutput(parsedChores);
            const newWeeklyData = generateWeeklyScheduleData(parsedChores);
            setWeeklySchedule(newWeeklyData);
        } else {
            setOrganizedPlanOutput("Could not parse the AI's response into a schedule. Raw output:\n" + data.content[0].text);
            setWeeklySchedule(null);
        }
      } else {
        setOrganizedPlanOutput('No text content received from Claude API.');
        setWeeklySchedule(null);
        throw new Error('No text content received from Claude API.');
      }
    } catch (error) {
      console.error('Failed to process chore organization:', error);
      if (!organizedPlanOutput) { // Only set if not already set by API error handling
        const errorMessage = error instanceof Error ? error.message : String(error);
        setOrganizedPlanOutput(`Failed to get organization plan: ${errorMessage}`);
      }
      setWeeklySchedule(null);
    } finally {
      setIsLoadingOrganizedPlan(false);
    }
  };

  return (
    <div className="min-h-screen bg-base-100 text-base-content font-sans">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 md:p-8">
        
        {/* Chores Selector Section */}
        <section className="mb-8 p-4 sm:p-6 bg-base-200 rounded-xl shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl sm:text-3xl font-bold text-base-content/90">Select Chores</h2>
            <button 
              className="btn btn-sm sm:btn-md btn-outline btn-primary"
              onClick={() => setIsChoreModalOpen(true)}
            >
              View All Chores
            </button>
          </div>
          {/* Chore Search Input */}
          <div className="mb-4">
        <input
          type="text"
              placeholder="Search chores (min. 3 chars)..."
              className="input input-bordered input-sm w-full max-w-md text-base-content/90 bg-base-100/50"
              value={choreSearchTerm}
              onChange={(e) => setChoreSearchTerm(e.target.value)}
            />
          </div>
          {chores.length === 0 && !choreSearchTerm ? ( 
            <p className="text-center text-base-content/70 py-10">Loading chores...</p>
          ) : filteredChores.length === 0 && choreSearchTerm.length >= 3 ? (
            <p className="text-center text-base-content/70 py-10">
              No chores found matching "{choreSearchTerm}".
            </p>
          ) : (
            <div
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-1 sm:p-2 border border-base-300/50 rounded-lg shadow-inner overflow-y-auto bg-base-100/30"
              style={{ maxHeight: '23rem' }} 
            >
              {filteredChores.map((chore) => (
                <button
                  key={chore.id}
                  title={chore.name}
                  className={`flex flex-col items-center justify-center w-full h-40 sm:h-44 p-2 sm:p-3 bg-base-200/70 hover:bg-base-300/70 border rounded-lg shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary transition-all duration-150 ease-in-out ${
                    selectedChores.find(sc => sc.id === chore.id)
                      ? 'border-primary ring-2 ring-primary/70' 
                      : 'border-base-300/70'
                  }`}
                  onClick={() => handleChoreSelect(chore)}
                >
                  <span className="text-3xl sm:text-4xl mb-2"> 
                    {chore.icon_identifier}
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-base-content/90 text-center break-words w-full px-1">
                    {chore.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Chore Selection Modal is outside the main flow but styled with DaisyUI */}
        <dialog id="chore_modal" className={`modal ${isChoreModalOpen ? 'modal-open' : ''}`}>
          <div className="modal-box w-11/12 max-w-5xl bg-base-200 shadow-xl">
            <h3 className="font-bold text-2xl mb-6 text-base-content/90">All Chores</h3>
            <div
              className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 p-1 sm:p-2 border-base-300/50 rounded-lg shadow-inner overflow-y-auto bg-base-100/30"
              style={{ maxHeight: '70vh' }} 
            >
              {filteredChores.map((chore) => (
                <button
                  key={`modal-${chore.id}`}
                  title={chore.name}
                  className={`flex flex-col items-center justify-center w-full h-40 sm:h-44 p-2 sm:p-3 bg-base-200/70 hover:bg-base-300/70 border rounded-lg shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary transition-all duration-150 ease-in-out ${
                    selectedChores.find(sc => sc.id === chore.id)
                      ? 'border-primary ring-2 ring-primary/70'
                      : 'border-base-300/70'
                  }`}
                  onClick={() => {
                    handleChoreSelect(chore);
                  }}
                >
                  <span className="text-3xl sm:text-4xl mb-2">
                    {chore.icon_identifier}
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-base-content/90 text-center break-words w-full px-1">
                    {chore.name}
                  </span>
                </button>
              ))}
            </div>
            <div className="modal-action mt-6">
              <form method="dialog">
                <button className="btn btn-neutral" onClick={() => setIsChoreModalOpen(false)}>Close</button>
              </form>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setIsChoreModalOpen(false)}>close</button>
          </form>
        </dialog>

        {/* Configuration Section: Plan Duration and API Key (Only if chores are selected) */}
        {selectedChores.length > 0 && (
          <section className="my-8 p-4 sm:p-6 bg-base-200 rounded-xl shadow-lg">
            <div className="grid md:grid-cols-2 gap-6 items-start">
              <div>
                <label htmlFor="plan-months-input" className="block text-sm font-medium text-base-content/80 mb-1">
                  Plan for the next:
                </label>
                <div className="flex items-center space-x-2">
                  <select
                    id="plan-months-input"
                    value={planMonths}
                    onChange={(e) => setPlanMonths(parseInt(e.target.value, 10))}
                    className="select select-bordered select-sm w-24 max-w-xs text-base-content/90 bg-base-100/50 text-center"
                  >
                    {Array.from({ length: 24 }, (_, i) => i + 1).map((monthNum) => (
                      <option key={monthNum} value={monthNum}>
                        {monthNum}
                      </option>
                    ))}
                  </select>
                  <span className="text-sm text-base-content/80">month(s)</span>
                </div>
              </div>
              <div>
                <label htmlFor="user-claude-api-key" className="block text-sm font-medium text-base-content/80 mb-1">
                  Your Claude API Key:
                </label>
                <input 
                  type="password" 
                  id="user-claude-api-key"
                  placeholder="Enter your Claude API key"
                  className="input input-bordered input-sm w-full max-w-xs text-base-content/90 bg-base-100/50"
                  value={userClaudeApiKey}
                  onChange={(e) => setUserClaudeApiKey(e.target.value)}
                />
                <p className="text-xs text-base-content/60 mt-1">
                  Stored in your browser. Used to generate the chore plan.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Actions: Selected Chores & Organize Button */}
        {selectedChores.length > 0 && (
           <section className="my-8 p-4 sm:p-6 bg-base-200 rounded-xl shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-base-content/90">Chores in Plan:</h3>
              <button 
                className="btn btn-ghost btn-sm text-error hover:bg-error/10"
                onClick={handleClearSelectedChores}
                title="Remove all selected chores"
              >
                Remove All
              </button>
            </div>
            <div className="flex flex-wrap justify-center gap-3 p-3 border border-base-300/50 rounded-lg shadow-inner min-h-[4rem] bg-base-100/30">
              {selectedChores.map((chore) => (
                <div key={`selected-${chore.id}`} className="relative group">
                  <div
                    title={chore.name}
                    className="p-2 bg-base-200/70 rounded-md shadow flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14"
                  >
                    <span className="text-xl sm:text-2xl">{chore.icon_identifier}</span>
                  </div>
                  <button 
                    onClick={() => handleChoreSelect(chore)} 
                    className="absolute -top-1.5 -right-1.5 btn btn-xs btn-circle btn-error opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150"
                    title={`Remove ${chore.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-6 text-center">
              <button 
                className="btn btn-primary btn-wide sm:btn-lg"
                onClick={handleOrganizeChores}
                disabled={isLoadingOrganizedPlan || !userClaudeApiKey}
              >
                {isLoadingOrganizedPlan ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Organizing...
                  </>
                ) : (
                  'Organize My Chores'
                )}
              </button>
      </div>
          </section>
        )}

        {/* Display AI Organized Plan Output */}
        {(isLoadingOrganizedPlan || organizedPlanOutput || weeklySchedule) && (
          <section className="my-8 p-4 sm:p-6 bg-base-200 rounded-xl shadow-lg">
            <h3 className="text-2xl sm:text-3xl font-bold mb-6 text-center text-base-content/90">
              Your Chore Plan
            </h3>
            {isLoadingOrganizedPlan && (
              <div className="flex flex-col justify-center items-center h-60">
                <span className="loading loading-dots loading-lg text-primary"></span>
                <p className="mt-4 text-base-content/80">Generating your plan...</p>
              </div>
            )}
            {/* Weekly Schedule Grid */}
            {weeklySchedule && !isLoadingOrganizedPlan && (
              <div className="mb-8 bg-base-100/50 p-2 sm:p-3 rounded-lg shadow-md">
                <h4 className="text-xl font-semibold mb-4 text-center text-base-content/90">Weekly Overview</h4>
                <div className="grid grid-cols-7 gap-px bg-base-300/40 border border-base-300/40 rounded overflow-hidden">
                  {DAYS_OF_WEEK.map(day => (
                    <div key={day} className="font-semibold text-xs sm:text-sm bg-base-100/60 text-base-content/80 py-2 text-center truncate px-1">{day}</div>
                  ))}
                  {DAYS_OF_WEEK.map(day => {
                    const dayData = weeklySchedule[day];
                    return (
                      <div key={`${day}-slots`} className="bg-base-100/40">
                        <div className="min-h-[4.5rem] sm:min-h-[5rem] p-1 sm:p-1.5 border-b border-base-300/40">
                          <div className="text-[0.6rem] sm:text-xs text-base-content/60 mb-1 text-center">Morning</div>
                          <div className="flex flex-col flex-wrap items-center justify-start gap-0.5 sm:gap-1 pt-0.5">
                            {dayData.Morning.map(chore => (
                              <span key={`${chore.raw}-morn-${day}`} className="text-xl sm:text-2xl tooltip tooltip-bottom" data-tip={`${chore.name} (Morning)`}>{chore.icon}</span>
                            ))}
                          </div>
                        </div>
                        <div className="min-h-[4.5rem] sm:min-h-[5rem] p-1 sm:p-1.5 border-b border-base-300/40">
                          <div className="text-[0.6rem] sm:text-xs text-base-content/60 mb-1 text-center">Afternoon</div>
                          <div className="flex flex-col flex-wrap items-center justify-start gap-0.5 sm:gap-1 pt-0.5">
                            {dayData.Afternoon.map(chore => (
                              <span key={`${chore.raw}-noon-${day}`} className="text-xl sm:text-2xl tooltip tooltip-bottom" data-tip={`${chore.name} (Afternoon)`}>{chore.icon}</span>
                            ))}
                          </div>
                        </div>
                        <div className="min-h-[4.5rem] sm:min-h-[5rem] p-1 sm:p-1.5">
                          <div className="text-[0.6rem] sm:text-xs text-base-content/60 mb-1 text-center">Night</div>
                          <div className="flex flex-col flex-wrap items-center justify-start gap-0.5 sm:gap-1 pt-0.5">
                            {dayData.Midnight.map(chore => (
                              <span key={`${chore.raw}-night-${day}`} className="text-xl sm:text-2xl tooltip tooltip-bottom" data-tip={`${chore.name} (Night)`}>{chore.icon}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Detailed List View */}
            {organizedPlanOutput && !isLoadingOrganizedPlan && (
              typeof organizedPlanOutput === 'string' ? (
                <pre className="whitespace-pre-wrap text-sm text-base-content/80 p-4 bg-error/10 border border-error rounded-md">
                  {organizedPlanOutput} 
                </pre>
              ) : (
                <div className="mt-6">
                  <h4 className="text-xl font-semibold mb-4 text-center text-base-content/90">Detailed Schedule</h4>
                  <ul className="space-y-3">
                    {organizedPlanOutput.map((item, index) => (
                      <li key={index} className="p-3 sm:p-4 bg-base-100/50 rounded-lg shadow-md border border-base-300/50">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
                          <span className="text-2xl sm:text-3xl p-1 sm:p-0">{item.icon}</span>
                          <div className="flex-grow">
                            <p className="font-semibold text-md sm:text-lg text-base-content/90">{item.name}</p>
                            <div className="text-xs sm:text-sm text-base-content/70 mt-0.5">
                              <p><span className="font-medium">Frequency:</span> {item.frequency}</p>
                              {item.days && <p><span className="font-medium">Day(s):</span> {item.days}</p>}
                              <p><span className="font-medium">Time:</span> {item.time}</p>
                            </div>
                          </div>
                          <a 
                            href={generateGoogleCalendarLink(item, planMonths)}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="btn btn-xs btn-outline btn-primary mt-2 sm:mt-0 self-start sm:self-center"
                          >
                            Add to Calendar
                          </a>
                        </div>
                        {(item.name === 'Unparsed Chore' || item.name === 'Unformatted Line') && (
                          <p className="mt-2 text-xs text-error/70">Original: {item.raw}</p>
                        )}
            </li>
          ))}
        </ul>
                </div>
              )
            )}
          </section>
      )}
      </div>
    </div>
  );
}

export default App;