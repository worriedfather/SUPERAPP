/* Fleet master, trip history and measured consumption.
   Derived from the DA card record and the operations tracker, Jan-Jun 2026.
   Replace with live master data before go-live. */

export const DRIVERS_SEED=[
["1000002","David Charuma","fleet"],
["1000004","Contastine Madimu","fleet"],
["1000005","Moses Perera","fleet"],
["1000007","Jackson Mamhovha","fleet"],
["1000008","John Taibo","fleet"],
["1000009","George Chisindi","fleet"],
["1000010","Ephraim Mukuze","fleet"],
["1000011","Gracious Chirimamhunga","fleet"],
["1000012","Forward Mukonyo","fleet"],
["1000013","Weston Mudondo","fleet"],
["1000014","Godwin Kahuni","fleet"],
["1000016","Josphat Butau","fleet"],
["1000017","Ernest Petro","fleet"],
["1000018","Israel Chipiyo","fleet"],
["1000019","workshops","retail"],
["1000084","Richard Paradzai","fleet"],
["1000340","Aaron Mudzingwa","fleet"],
["1000342","Tafadzwa Mutemachani","fleet"],
["1000343","John zvaita","fleet"],
["1000344","Masiye Taibo","fleet"],
["1000888","Nyasha Tukuta","fleet"],
["1000889","Luckmore Chinzou","fleet"],
["1001233","Alec Mahachuya","fleet"],
["1001234","Nathan Tanga","fleet"],
["1001236","Jowell Chaonamumwe","fleet"],
["1001237","owen Tinashe Ndoro","fleet"],
["1001238","Obert Magaya","fleet"],
["1001693","Thompson Chimombe","fleet"],
["1002022","Padmore Mapenzauswa","fleet"],
["1002023","Donald Munyoro","fleet"],
["1002030","Never Matawu","fleet"],
["1002031","Gerald Sobrinyu Sobrinyu","fleet"],
["1002252","Shiraz Bhura","retail"],
["1003940","Milton Moyo","fleet"],
["1003941","Desmond Tavengerwa","fleet"],
["1003942","Prosper Mhiti","fleet"],
["1003943","Chamunorwa Nyakudanga","fleet"],
["1003944","Terrence Manjengwa","fleet"],
["1004082","Bongani Dube","fleet"],
["1004107","Anderson Shito","fleet"],
["1004108","Maclenon Munyaradzi Chirume","fleet"],
["1004124","Romeo Panashe Mutasa","retail"],
["1004372","Ephraim Banda","fleet"],
["1004374","Tatenda Kahuni","fleet"],
["1004375","Michael Taperia","fleet"],
["1004376","Emmerson Kufa","fleet"]
].map(([card,name,type])=>({card,name,type}));
export const HORSES_SEED=[
["M1","T15",2.27],
["M2","T16",1.96],
["SH1","T25",2.00],
["S1","T12",2.27],
["SH2","T26",2.01],
["S2","T12",2.27],
["S3","T14",2.32],
["SH3","T34",1.54],
["S4","T19",2.27],
["S5","T11",1.95],
["S6","T23",2.12],
["S7","T13",2.53],
["S8","T24",2.27],
["S9","T27",1.96],
["S10","T28",2.29],
["S11","T29",1.90],
["S12","T30",2.01],
["S13","T9",1.90],
["S14","T33",1.88],
["S15","T31",2.27],
["S16","T2",2.34],
["S17","T1",2.52],
["S18","T32",2.58],
["V0","T22",2.27],
["V1","T3",1.90],
["V2","T4",2.27],
["V3","T18",2.44],
["V5","T5",1.88],
["V6","T6",2.01],
["V7","T7",2.40],
["V8","T8",2.27],
["V9","T22",2.26],
["V10","T10",2.27],
["V12","T18",2.44],
["V14","T17",2.27],
["V15","T20",2.27],
["V16","T21",2.27]
].map(([code,trailer,kmpl])=>({code,trailer,kmpl}));
export const TRAILERS=["T1","T2","T3","T4","T5","T6","T7","T8","T09","T9","T10","T11","T12","T13","T14","T15","T16","T17","T18","T19","T20","T21","T22","T23","T24","T25","T26","T27","T28","T29","T30","T31","T32","T33","T34"].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
export const RETAIL_VEH=[
["ACM 4537","Workshop bakkie"],
["AHF 6561","Workshop bakkie 2"],
["ADI 7887","Isuzu double cab"],
["AHG 6977","Toyota Hilux"],
["AFS 7650","Ford Ranger"],
["GEN-01","Yard generator"],
["FL-01","Forklift"]
].map(([code,desc])=>({code,desc}));
export const FLEET_MEDIAN=2.3;

export const HISTORY={"M1":[{"m":"2026-04","dest":"waterfalls noic","L":30,"km":30},{"m":"2026-04","dest":"mabvuku kambazuma","L":30,"km":70},{"m":"2026-07","dest":"easytrack","L":30,"km":20},{"m":"2026-07","dest":"VID","L":20,"km":20},{"m":"2026-07","dest":"noic","L":20,"km":5},{"m":"2026-07","dest":"G/side speed noic","L":40,"km":50}],"M2":[{"m":"2026-07","dest":"murehwa noic","L":80,"km":200},{"m":"2026-07","dest":"willowvale kambazuma noic","L":30,"km":60},{"m":"2026-07","dest":"kaunda noic","L":30,"km":50},{"m":"2026-07","dest":"glenara noic","L":30,"km":30},{"m":"2026-07","dest":"glenara noic","L":40,"km":30},{"m":"2026-07","dest":"mabvuku greencroft","L":40,"km":60}],"S12":[{"m":"2026-07","dest":"zengeza noic","L":40,"km":85},{"m":"2026-07","dest":"glenara noic","L":30,"km":30},{"m":"2026-07","dest":"epworth kambazuma noic","L":35,"km":60},{"m":"2026-07","dest":"DZ kambazuma noic","L":40,"km":70},{"m":"2026-07","dest":"kadoma noic","L":130,"km":300},{"m":"2026-07","dest":"Gokwe noic","L":280,"km":700}],"S14":[{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560},{"m":"2026-07","dest":"rusape nyanga mutare","L":150,"km":300},{"m":"2026-07","dest":"mutare feruka","L":40,"km":30},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"zvishavane mutare top up route change","L":30,"km":400},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600}],"S16":[{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560},{"m":"2026-07","dest":"mutare zvishavane mutare","L":380,"km":920},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560}],"S17":[{"m":"2026-07","dest":"mutare masvingo mutare","L":330,"km":720},{"m":"2026-07","dest":"mutare zvishavani mutare","L":380,"km":920},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":170,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560}],"S2":[{"m":"2026-07","dest":"glenara","L":30,"km":30},{"m":"2026-07","dest":"msasa glenara noic","L":30,"km":30},{"m":"2026-07","dest":"southley noic","L":35,"km":85},{"m":"2026-07","dest":"willowvale noic","L":40,"km":50},{"m":"2026-07","dest":"ardbennie noic","L":40,"km":40},{"m":"2026-07","dest":"southley noic","L":50,"km":80}],"S5":[{"m":"2026-07","dest":"glenara bindura noic","L":80,"km":190},{"m":"2026-07","dest":"glenara epworth noic","L":35,"km":60},{"m":"2026-07","dest":"maqbvuku g/side speed noic","L":40,"km":70},{"m":"2026-07","dest":"chitungwiza noic","L":40,"km":90},{"m":"2026-07","dest":"chiremba gletwyn murehwa noic","L":120,"km":220},{"m":"2026-07","dest":"mabvuku kaunda epworth noic","L":40,"km":80}],"SH2":[{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":200,"km":600},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":200,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":190,"km":560}],"SH3":[{"m":"2026-07","dest":"wilowvale southley noic","L":50,"km":85},{"m":"2026-07","dest":"marondera noic","L":65,"km":140},{"m":"2026-07","dest":"chinhoui noic","L":120,"km":270},{"m":"2026-07","dest":"mabvuku speed kirkman noic","L":40,"km":90},{"m":"2026-07","dest":"speed g/side southley","L":40,"km":85},{"m":"2026-07","dest":"avondale greencroft","L":40,"km":50}],"V12":[{"m":"2026-03","dest":"mutare rusape zvishavani","L":400,"km":950},{"m":"2026-03","dest":"mutare zvishavani mutare","L":380,"km":920},{"m":"2026-03","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-03","dest":"bulawayo mutare","L":160,"km":560},{"m":"2026-03","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-03","dest":"bulawayo mutare","L":160,"km":560}],"V15":[{"m":"2026-07","dest":"avondale greencroft noic","L":40,"km":60},{"m":"2026-07","dest":"chitungwiza noic","L":40,"km":85},{"m":"2026-07","dest":"chiremba chinhoyi noic","L":125,"km":280},{"m":"2026-07","dest":"marondera noic","L":80,"km":140},{"m":"2026-07","dest":"avondale kirkman noic","L":50,"km":85},{"m":"2026-07","dest":"kaunda speed noic","L":30,"km":50}],"V2":[{"m":"2026-07","dest":"chitungwiza noic","L":40,"km":90},{"m":"2026-07","dest":"hatcliff gletwyn g/side noic","L":40,"km":100},{"m":"2026-07","dest":"masimba kalamain noic","L":40,"km":70},{"m":"2026-07","dest":"waterfalls kambazuma gletwyn noic","L":50,"km":80},{"m":"2026-07","dest":"chegutu gokwe noic","L":300,"km":700},{"m":"2026-07","dest":"chegutu kadoma kwekwe noic","L":190,"km":470}],"V5":[{"m":"2026-07","dest":"willowvale southley","L":40,"km":70},{"m":"2026-07","dest":"gletwyn bindura","L":100,"km":200},{"m":"2026-07","dest":"chitungwiza noic","L":40,"km":85},{"m":"2026-07","dest":"greencroft avondale noic","L":40,"km":60},{"m":"2026-07","dest":"waterfalls noic","L":40,"km":60},{"m":"2026-07","dest":"chitungwiza","L":50,"km":90}],"V6":[{"m":"2026-07","dest":"chiremba epworth dzivarasekwa","L":40,"km":70},{"m":"2026-07","dest":"Mabvuku speed waterfalls g/side noic","L":50,"km":100},{"m":"2026-07","dest":"kwekwe noic","L":200,"km":450},{"m":"2026-07","dest":"kuwadzana kadoma noic","L":130,"km":300},{"m":"2026-07","dest":"waterfalls kuwadzana noic","L":40,"km":70},{"m":"2026-07","dest":"chiremba g/side willowvale","L":40,"km":80}],"V8":[{"m":"2026-07","dest":"bulawayo harare","L":160,"km":450},{"m":"2026-07","dest":"harare mutare","L":130,"km":450},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":190,"km":560},{"m":"2026-07","dest":"mutare rusape mutare","L":80,"km":180},{"m":"2026-07","dest":"mutare to beitbridge mutare","L":500,"km":1300}],"V9":[{"m":"2026-07","dest":"mutare rusape nyanga","L":170,"km":300},{"m":"2026-07","dest":"top up rusape harare","L":70,"km":136},{"m":"2026-07","dest":"noic","L":30,"km":5},{"m":"2026-07","dest":"chirundu kariba","L":400,"km":880},{"m":"2026-07","dest":"chinhoyi top up to noic","L":60,"km":120},{"m":"2026-07","dest":"g/side kambazuma willowvale","L":40,"km":70}],"S13":[{"m":"2026-07","dest":"kwekwe mine noic","L":240,"km":610},{"m":"2026-07","dest":"kwekwe mine noic","L":240,"km":610},{"m":"2026-07","dest":"kwekwe mine","L":240,"km":610},{"m":"2026-07","dest":"kwekwe mine","L":240,"km":610},{"m":"2026-07","dest":"kwekwe mine noic","L":240,"km":610},{"m":"2026-07","dest":"kwekwe mine noic","L":240,"km":610}],"S15":[{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":180,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":190,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":180,"km":560}],"S18":[{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":190,"km":560}],"S3":[{"m":"2026-07","dest":"bulawayo mutare","L":190,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560},{"m":"2026-07","dest":"mutare zvishavane mutare","L":380,"km":920}],"S6":[{"m":"2026-06","dest":"bulawayo mutare","L":170,"km":560},{"m":"2026-06","dest":"mutare zvishavane feruka","L":350,"km":920},{"m":"2026-07","dest":"SGS","L":40,"km":60},{"m":"2026-07","dest":"VID","L":30,"km":25},{"m":"2026-07","dest":"sgs","L":30,"km":60},{"m":"2026-07","dest":"epworth waterfalls noic","L":50,"km":70}],"SH1":[{"m":"2026-07","dest":"bulawayo mutare","L":200,"km":560},{"m":"2026-07","dest":"mutare gweru bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":200,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"mutare beitbridge mutare","L":500,"km":1300},{"m":"2026-07","dest":"mutare harare","L":140,"km":280}],"V7":[{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":190,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":190,"km":560},{"m":"2026-07","dest":"mutare rusape marondera msasa","L":140,"km":300},{"m":"2026-07","dest":"chitungwiza noic","L":40,"km":85}],"S10":[{"m":"2026-07","dest":"kiurkman noic","L":35,"km":75},{"m":"2026-07","dest":"g/side chiremba noic","L":30,"km":70},{"m":"2026-07","dest":"bindura noic","L":80,"km":200},{"m":"2026-07","dest":"murehwa noic","L":80,"km":210},{"m":"2026-07","dest":"gletwyn speed noic","L":40,"km":80},{"m":"2026-07","dest":"Dzivarasekwa kambazuma noic","L":40,"km":80}],"S8":[{"m":"2026-07","dest":"avondale greencroft noic","L":30,"km":65},{"m":"2026-07","dest":"marondera noic","L":60,"km":140},{"m":"2026-07","dest":"glenara noic","L":40,"km":30},{"m":"2026-07","dest":"kaunda greencroft noic","L":40,"km":60},{"m":"2026-07","dest":"chikwana makoni noic","L":50,"km":90},{"m":"2026-07","dest":"avondale greencroft","L":40,"km":70}],"S9":[{"m":"2026-07","dest":"kwekwe noic","L":220,"km":450},{"m":"2026-07","dest":"msasa gokwe noic","L":200,"km":700},{"m":"2026-07","dest":"gokwe noic","L":100,"km":320},{"m":"2026-07","dest":"southley noic","L":50,"km":80},{"m":"2026-07","dest":"kwekwe noic","L":200,"km":470},{"m":"2026-07","dest":"chegutu noic","L":40,"km":112}],"V10":[{"m":"2026-07","dest":"mutare zvishavani mutare","L":380,"km":920},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":180,"km":560},{"m":"2026-07","dest":"mutare gweu mutare","L":330,"km":800},{"m":"2026-07","dest":"mutare nyanga mutare","L":100,"km":210},{"m":"2026-07","dest":"nyanga mutare top up","L":30,"km":100}],"V16":[{"m":"2026-07","dest":"marondera noic","L":60,"km":140},{"m":"2026-07","dest":"makoni noic","L":40,"km":85},{"m":"2026-07","dest":"msasa VID Msasa","L":30,"km":30},{"m":"2026-07","dest":"noic","L":50,"km":5},{"m":"2026-07","dest":"kuwadzana kwekwe noic","L":190,"km":520},{"m":"2026-07","dest":"bindura noic","L":80,"km":190}],"V14":[{"m":"2026-07","dest":"epworth g/side noic","L":40,"km":60},{"m":"2026-07","dest":"chitubgwiza noic","L":45,"km":80},{"m":"2026-07","dest":"chinhoyi noic","L":120,"km":250},{"m":"2026-07","dest":"mabvuku g/side waterfalls noic","L":50,"km":60},{"m":"2026-07","dest":"marondera noic","L":70,"km":140},{"m":"2026-07","dest":"zengeza noic","L":40,"km":85}],"S11":[{"m":"2026-07","dest":"bulawayo mutare","L":180,"km":560},{"m":"2026-07","dest":"chiredzi beitbridge mutare","L":500,"km":1300},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"masvingo mutare.. route change","L":100,"km":390},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":200,"km":560}],"S4":[{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560},{"m":"2026-07","dest":"rusape nyanga mutare","L":150,"km":300},{"m":"2026-07","dest":"feruka","L":30,"km":30},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":170,"km":560},{"m":"2026-07","dest":"mutare bulawaqyo","L":350,"km":600}],"V3":[{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":170,"km":560},{"m":"2026-07","dest":"mutare masvingo mutare","L":350,"km":720},{"m":"2026-07","dest":"mutare rusape chivu","L":250,"km":580},{"m":"2026-07","dest":"FERUKA","L":40,"km":40},{"m":"2026-07","dest":"mutare masvingo zvishavane mutare","L":380,"km":920}],"S7":[{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":150,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560},{"m":"2026-07","dest":"mutare bulawayo","L":350,"km":600},{"m":"2026-07","dest":"bulawayo mutare","L":160,"km":560}],"V1":[{"m":"2026-07","dest":"mabvuku gletwyn wayerfalls noic","L":50,"km":90},{"m":"2026-07","dest":"kwekwe noic","L":200,"km":460},{"m":"2026-07","dest":"southley noic","L":40,"km":85},{"m":"2026-07","dest":"kariba chirundu noic","L":400,"km":880},{"m":"2026-07","dest":"greencroft noic","L":30,"km":25},{"m":"2026-07","dest":"ardbennie","L":30,"km":40}]};
export const DEST_NORM={"noic":{"n":39,"med":30,"p10":20,"p90":40},"mutare beitbridge":{"n":11,"med":500,"p10":460,"p90":500},"bulawayo mutare":{"n":497,"med":160,"p10":160,"p90":180},"southley park":{"n":9,"med":40,"p10":30,"p90":60},"feruka":{"n":57,"med":40,"p10":20,"p90":40},"chitungwiza":{"n":62,"med":40,"p10":30,"p90":60},"chegutu kadoma kwekwe":{"n":13,"med":190,"p10":180,"p90":200},"kwekwe":{"n":38,"med":190,"p10":170,"p90":200},"murewha":{"n":21,"med":80,"p10":75,"p90":90},"avondale greencroft":{"n":31,"med":40,"p10":30,"p90":50},"kwekwe mine":{"n":54,"med":240,"p10":240,"p90":240},"mutare bulawayo":{"n":532,"med":350,"p10":350,"p90":350},"bulawayo harare":{"n":38,"med":150,"p10":140,"p90":170},"none":{"n":84,"med":40,"p10":5,"p90":140},"mutare rusape":{"n":11,"med":85,"p10":75,"p90":100},"mutare gweru mutare":{"n":10,"med":340,"p10":330,"p90":380},"vid":{"n":15,"med":30,"p10":20,"p90":40},"masvingo mutare":{"n":9,"med":90,"p10":30,"p90":330},"bulawayo hre":{"n":9,"med":150,"p10":150,"p90":170},"marondera":{"n":31,"med":70,"p10":55,"p90":80},"hre mutare":{"n":12,"med":125,"p10":120,"p90":130},"mutare zvishavane mutare":{"n":15,"med":380,"p10":380,"p90":380},"willowvale":{"n":8,"med":40,"p10":30,"p90":40},"glenara":{"n":29,"med":30,"p10":20,"p90":40},"waterfalls":{"n":12,"med":40,"p10":30,"p90":60},"mutare":{"n":9,"med":120,"p10":60,"p90":130},"chitungwiza noic":{"n":32,"med":40,"p10":40,"p90":50},"ardbennie":{"n":10,"med":35,"p10":30,"p90":50},"southley noic":{"n":18,"med":40,"p10":40,"p90":50},"chegutu kadoma":{"n":8,"med":128,"p10":120,"p90":130},"southley":{"n":12,"med":40,"p10":30,"p90":50},"mutare masvingo":{"n":11,"med":300,"p10":300,"p90":300},"gokwe":{"n":11,"med":300,"p10":260,"p90":350},"mutare zvishavani":{"n":12,"med":380,"p10":380,"p90":380},"harare mutare":{"n":15,"med":130,"p10":120,"p90":130},"mutare gweru bulawayo":{"n":8,"med":350,"p10":350,"p90":350},"glenara noic":{"n":47,"med":30,"p10":20,"p90":40},"mutare rusape mutare":{"n":8,"med":80,"p10":70,"p90":80},"marondera noic":{"n":43,"med":70,"p10":60,"p90":70},"bindura":{"n":8,"med":82,"p10":80,"p90":90},"service":{"n":21,"med":5,"p10":4,"p90":20},"mutare rusape bulawayo":{"n":16,"med":350,"p10":350,"p90":400},"mutare zvishavani mutare":{"n":20,"med":380,"p10":380,"p90":380},"mutare masvingo mutare":{"n":15,"med":350,"p10":300,"p90":380},"willowvale noic":{"n":20,"med":38,"p10":30,"p90":40},"bindura noic":{"n":24,"med":82,"p10":80,"p90":90},"mutare chiredzi beitbridge mutare":{"n":8,"med":500,"p10":500,"p90":520},"makoni noic":{"n":14,"med":40,"p10":30,"p90":40},"greencroft noic":{"n":8,"med":30,"p10":30,"p90":50},"epworth noic":{"n":11,"med":30,"p10":20,"p90":40},"fibion":{"n":33,"med":40,"p10":40,"p90":60},"murehwa noic":{"n":14,"med":85,"p10":80,"p90":90},"shiraz":{"n":13,"med":60,"p10":30,"p90":60},"kwekwe mine noic":{"n":30,"med":240,"p10":240,"p90":240},"kwekwe noic":{"n":36,"med":200,"p10":190,"p90":200},"gokwe noic":{"n":21,"med":300,"p10":260,"p90":300},"chegutu kadoma kwekwe noic":{"n":8,"med":190,"p10":190,"p90":200},"msasa mutare":{"n":11,"med":130,"p10":120,"p90":130},"faizan":{"n":15,"med":30,"p10":20,"p90":48},"dave":{"n":11,"med":30,"p10":30,"p90":40},"avondale greencroft noic":{"n":15,"med":40,"p10":40,"p90":40}};

export const EFF={local:1.7,hwy:2.52,horse:{"S16":{"loc":1.62,"hwy":2.62,"nl":7,"nh":92},"S6":{"loc":0.96,"hwy":2.15,"nl":4,"nh":77},"SH1":{"loc":1.07,"hwy":2.42,"nl":7,"nh":76},"S7":{"loc":1.41,"hwy":2.64,"nl":8,"nh":72},"SH2":{"loc":1.5,"hwy":2.51,"nl":27,"nh":66},"S3":{"loc":1.18,"hwy":2.62,"nl":9,"nh":63},"S14":{"loc":2.15,"hwy":2.61,"nl":5,"nh":61},"S10":{"loc":1.75,"hwy":2.59,"nl":40,"nh":49},"V7":{"loc":1.02,"hwy":2.48,"nl":8,"nh":49},"V12":{"loc":1.42,"hwy":2.48,"nl":12,"nh":47},"S13":{"loc":1.58,"hwy":2.28,"nl":26,"nh":45},"S12":{"loc":1.55,"hwy":2.55,"nl":53,"nh":35},"S9":{"loc":1.44,"hwy":2.37,"nl":74,"nh":30},"V6":{"loc":1.84,"hwy":2.48,"nl":56,"nh":19},"S5":{"loc":1.86,"hwy":2.49,"nl":68,"nh":16},"M2":{"loc":1.62,"hwy":2.33,"nl":40,"nh":16},"SH3":{"loc":1.57,"hwy":2.21,"nl":51,"nh":6}}};
export const ROUTE_PRIOR={"DA Yard|DA Yard":{"kmpl":1.98,"n":1157},"Bulawayo Fairbridge|Mutare 4th Street":{"kmpl":1.95,"n":512},"Mutare 4th Street|Mutare 4th Street":{"kmpl":2.58,"n":271},"DA Yard|Glenara":{"kmpl":2.36,"n":123},"DA Yard|Mutare 4th Street":{"kmpl":2.4,"n":86},"Bulawayo North End|Mutare 4th Street":{"kmpl":1.9,"n":66},"Bulawayo Khami|Mutare 4th Street":{"kmpl":2.57,"n":52},"Glenara|Glenara":{"kmpl":2.57,"n":49},"Bulawayo Fife Street|Mutare 4th Street":{"kmpl":1.88,"n":49},"Bulawayo Fairbridge|DA Yard":{"kmpl":2.85,"n":25},"Chegutu|DA Yard":{"kmpl":2.08,"n":20},"Bulawayo Goderich|Mutare 4th Street":{"kmpl":1.92,"n":17},"Cowdray Park|Mutare 4th Street":{"kmpl":1.88,"n":17},"Bulawayo Luveve|Mutare 4th Street":{"kmpl":1.87,"n":15},"Masvingo Mucheke|Mutare 4th Street":{"kmpl":2.09,"n":14},"Bulawayo Fort Street|Mutare 4th Street":{"kmpl":1.85,"n":12},"Bulawayo Main Street|Mutare 4th Street":{"kmpl":2.49,"n":12},"DA Yard|Kuwadzana":{"kmpl":2.47,"n":11},"Mutare 4th Street|Rusape":{"kmpl":2.55,"n":10},"Beitbridge|Mutare 4th Street":{"kmpl":2.66,"n":8},"Masvingo|Mutare 4th Street":{"kmpl":1.81,"n":8},"DA Yard|Marondera Avoca":{"kmpl":3.12,"n":7},"Mabvuku|Mutare 4th Street":{"kmpl":2.43,"n":7},"DA Yard|Gletwyn":{"kmpl":1.19,"n":6},"Bulawayo Ashys|Mutare 4th Street":{"kmpl":2.5,"n":6},"Bulawayo Matopos Rd|Mutare 4th Street":{"kmpl":2.75,"n":6},"Gweru Amtec|Mutare 4th Street":{"kmpl":1.7,"n":6},"Chiredzi|Mutare 4th Street":{"kmpl":2.23,"n":6}};
export const LOCAL_KM=160;
