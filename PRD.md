      1 +# Product Requirements Document                                                                   w                                    
      2 +                                                                                                                                      
      3 +## Document Intent                                                                                                                    
      4 +This document defines the product at a high level so it can be rebuilt from first principles with a cleaner direction. It stays focuse
         d on product purpose, user experience, behavior, and outcomes rather than implementation detail.                                      
      5 +                                                                                                                                      
      6 +## Product Name                                                                                                                       
      7 +LocalWispr                                                                                                                            
      8 +                                                                                                                                      
      9 +## Short Description                                                                                                                  
     10 +LocalWispr is a Windows desktop voice-to-text companion that lets a user trigger dictation instantly, speak naturally, see live transc
         ription in a small focused popup, insert text into the active workflow, and reopen recent transcript history when needed.             
     11 +                                                                                                                                      
     12 +## Purpose                                                                                                                            
     13 +The purpose of LocalWispr is to remove friction between speaking and writing. It is meant for people who want to capture thoughts, wri
         te messages, draft content, respond quickly, or enter text across any Windows workflow without breaking focus or changing applications
         .                                                                                                                                     
     14 +                                                                                                                                      
     15 +## Why We Are Building This                                                                                                           
     16 +Typing is often slower than thinking. Existing voice tools frequently feel heavy, distracting, unreliable, or disconnected from the pl
         ace where the user actually wants text to appear. LocalWispr exists to make dictation feel immediate, lightweight, and always availabl
         e. The product should feel less like opening an app and more like summoning a capability.                                             
     17 +                                                                                                                                      
     18 +## Product Vision                                                                                                                     
     19 +LocalWispr should become a background utility that is always ready, fast to invoke, simple to understand, and easy to trust. The exper
         ience should feel direct: open it, speak, confirm the result, continue working. It should support momentum instead of interrupting it.
     20 +                                                                                                                                      
     21 +## Platform                                                                                                                           
     22 +LocalWispr is built for Windows. The product is intended to live naturally inside a Windows desktop workflow and support users across 
         documents, chat tools, browsers, notes, forms, and other text-heavy environments.                                                     
     23 +                                                                                                                                      
     24 +## Primary Use Case                                                                                                                   
     25 +The user wants to speak instead of type and have that speech become usable text with as little effort as possible. The app should appe
         ar quickly, capture speech, transcribe it in real time, and return the result to the user’s active context with minimal interruption. 
     26 +                                                                                                                                      
     27 +## Secondary Use Case                                                                                                                 
     28 +The user wants to revisit recent dictated text, copy it again, recover something that was cancelled, or inspect earlier transcripts wi
         thout having to repeat the recording process.                                                                                         
     29 +                                                                                                                                      
     30 +## Core Product Idea                                                                                                                  
     31 +The app runs quietly in the background and is opened with a keyboard shortcut. A compact popup appears when the user wants to dictate.
          The user speaks, sees the transcript update live, and then either completes the action or dismisses it. The app then gets out of the 
         way. A separate history view allows the user to reopen recent transcripts and reuse them quickly.                                     
     32 +                                                                                                                                      
     33 +## How The Product Works                                                                                                              
     34 +- The app stays available in the background on Windows.                                                                               
     35 +- The user opens dictation with a shortcut.                                                                                           
     36 +- A compact popup appears for the recording session.                                                                                  
     37 +- The user speaks and sees live transcription.                                                                                        
     38 +- The user can finish, cancel, or dismiss the session.                                                                                
     39 +- Completed text is returned to the user’s active workflow.                                                                           
     40 +- Recent transcripts are stored in a lightweight history view.                                                                        
     41 +- The history view can be opened and closed quickly from a dedicated shortcut.                                                        
     42 +- The app remains small, fast, and present only when needed.                                                                          
     43 +                                                                                                                                      
     44 +## User Experience Goals                                                                                                              
     45 +- Instant access                                                                                                                      
     46 +- Minimal visual friction                                                                                                             
     47 +- Clear state at every moment                                                                                                         
     48 +- Fast transcription feedback                                                                                                         
     49 +- Simple completion and cancellation                                                                                                  
     50 +- Fast recovery through history                                                                                                       
     51 +- Reliable background behavior                                                                                                        
     52 +- Low cognitive load                                                                                                                  
     53 +                                                                                                                                      
     54 +## Product Principles                                                                                                                 
     55 +- The app should feel lightweight.                                                                                                    
     56 +- The app should avoid forcing the user into a long flow.                                                                             
     57 +- The app should respect the user’s current context.                                                                                  
     58 +- The app should behave predictably.                                                                                                  
     59 +- The app should be quick to open and quick to leave.                                                                                 
     60 +- The experience should support repeated daily use.                                                                                   
     61 +                                                                                                                                      
     62 +## Target Users                                                                                                                       
     63 +- People who write frequently on Windows                                                                                              
     64 +- Users who switch often between thinking and typing                                                                                  
     65 +- People who want quick dictation for messages, notes, and drafts                                                                     
     66 +- Users who need a small voice utility instead of a large workspace                                                                   
     67 +- People who value shortcut-driven workflows                                                                                          
     68 +                                                                                                                                      
     69 +## User Problems This Solves                                                                                                          
     70 +- Losing speed when typing interrupts thought                                                                                         
     71 +- Switching apps just to dictate text                                                                                                 
     72 +- Repeating the same dictated content after cancellation or interruption                                                              
     73 +- Needing quick access to recent transcript output                                                                                    
     74 +- Wanting voice input without a heavy or distracting interface                                                                        
     75 +                                                                                                                                      
     76 +## Core Product Capabilities                                                                                                          
     77 +- Background availability                                                                                                             
     78 +- Shortcut-based activation                                                                                                           
     79 +- Live voice transcription                                                                                                            
     80 +- Compact recording interface                                                                                                         
     81 +- Fast completion and dismissal                                                                                                       
     82 +- Text insertion into the active workflow                                                                                             
     83 +- Transcript history                                                                                                                  
     84 +- Copy and reuse of previous transcript entries                                                                                       
     85 +- Persistent user setup through saved credentials                                                                                     
     86 +                                                                                                                                      
     87 +## AI Model                                                                                                                           
     88 +The current speech transcription model is Soniox `stt-rt-preview`.                                                                    
     89 +
     90 +## API Key Handling                                                                                                                   
     91 +The product requires the user to provide an API key for the transcription model. The app stores that API key locally on the device so 
         the user does not need to re-enter it every time the app is used. This setup should feel simple and persistent from the user’s perspec
         tive.                                                                                                                                 
     92 +                                                                                                                                      
     93 +## History Experience                                                                                                                 
     94 +History is a core recovery and reuse layer for the product. It should allow users to reopen recent transcript results, review them qui
         ckly, copy text again, and clear older items when they no longer matter. History should feel like a fast utility, not a separate works
         pace.                                                                                                                                 
     95 +                                                                                                                                      
     96 +## Recording Experience                                                                                                               
     97 +The recording experience should feel immediate and obvious. The user should always understand whether the app is ready, actively liste
         ning, transcribing, or finished. The popup should support quick interaction and should never feel like a heavy window or a full applic
         ation mode.                                                                                                                           
     98 +                                                                                                                                      
     99 +## Shortcut Experience                                                                                                                
    100 +Shortcuts are central to the product identity. They are the fastest way to enter and leave the experience. The user should be able to 
         rely on shortcuts to open dictation, open history, and dismiss temporary UI without confusion.                                        
    101 +                                                                                                                                      
    102 +## Background Presence                                                                                                                
    103 +The app should operate like a utility that lives near the system rather than demanding full attention. It should be easy to access whe
         n needed and easy to ignore when not needed. It should support a natural desktop rhythm.                                              
    104 +                                                                                                                                      
    105 +## Expected Product Feel                                                                                                              
    106 +The app should feel fast, quiet, responsive, and dependable. It should create confidence that speaking will quickly become usable text
         . It should encourage repeated use because the interaction is short, clear, and low effort.                                           
    107 Hedl<leond> Can you hear me?<end>+                                                                                                                                      #DH CJA -'DC 4H #.('1C *3E9FJ -'DJ'K J' 9D'! Can you hear me, bro?<end>) 
    108 +## Value Proposition                                                                                                                  
    109 +LocalWispr gives Windows users a faster path from speech to text inside their normal workflow. Its value comes from immediate access, 
         small surface area, live feedback, and the ability to recover and reuse previous transcripts without friction.                        
    110 +                                                                                                                                      
    111 +## Rebuild Direction                                                                                                                  
    112 +This product should be rebuilt with a cleaner product mindset centered on speed, stability, clarity, and trust. The goal is not to pre
         serve every current behavior exactly as it exists today. The goal is to preserve the core promise of the app while rebuilding the expe
         rience so it feels cohesive, reliable, and intentional.                                                                               
    113 +                                                                                                                                      
    114 +## Desired Outcome                                                                                                                    
    115 +The finished product should feel like a dependable Windows dictation companion that users can keep running all day, call up instantly,
          use for short or frequent voice input, and trust to return useful text without disrupting the rest of their work.
                                                                                                                             