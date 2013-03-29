/*
JSLinux-deobfuscated - An annotated version of the original JSLinux.

Original is Copyright (c) 2011-2012 Fabrice Bellard
Redistribution or commercial use is prohibited without the author's permission.

8254 Programmble Interrupt Timer Emulator
*/
function PIT(PC, ah, bh) {
    var s, i;
    this.pit_channels = new Array();
    for (i = 0; i < 3; i++) {
        s = new IRQCH(bh);
        this.pit_channels[i] = s;
        s.mode = 3;
        s.gate = (i != 2) >> 0;
        s.pit_load_count(0);
    }
    this.speaker_data_on = 0;
    this.set_irq = ah;
    // Ports:
    // 0x40: Channel 0 data port
    // 0x61: Control
    PC.register_ioport_write(0x40, 4, 1, this.ioport_write.bind(this));
    PC.register_ioport_read(0x40, 3, 1, this.ioport_read.bind(this));
    PC.register_ioport_read(0x61, 1, 1, this.speaker_ioport_read.bind(this));
    PC.register_ioport_write(0x61, 1, 1, this.speaker_ioport_write.bind(this));
}



function IRQCH(bh) {
    this.count = 0;
    this.latched_count = 0;
    this.rw_state = 0;
    this.mode = 0;
    this.bcd = 0;
    this.gate = 0;
    this.count_load_time = 0;
    this.get_ticks = bh;
    this.pit_time_unit = 1193182 / 2000000;
}
IRQCH.prototype.get_time = function() {
    return Math.floor(this.get_ticks() * this.pit_time_unit);
};
IRQCH.prototype.pit_get_count = function() {
    var d, dh;
    d = this.get_time() - this.count_load_time;
    switch (this.mode) {
        case 0:
        case 1:
        case 4:
        case 5:
            dh = (this.count - d) & 0xffff;
            break;
        default:
            dh = this.count - (d % this.count);
            break;
    }
    return dh;
};
IRQCH.prototype.pit_get_out = function() {
    var d, eh;
    d = this.get_time() - this.count_load_time;
    switch (this.mode) {
        default:
	// Interrupt on terminal count
        case 0:
            eh = (d >= this.count) >> 0;
            break;
	// One shot
        case 1:
            eh = (d < this.count) >> 0;
            break;
	// Frequency divider
        case 2:
            if ((d % this.count) == 0 && d != 0)
                eh = 1;
            else
                eh = 0;
            break;
	// Square wave
        case 3:
            eh = ((d % this.count) < (this.count >> 1)) >> 0;
            break;
	// SW strobe
        case 4:
	// HW strobe
        case 5:
            eh = (d == this.count) >> 0;
            break;
    }
    return eh;
};
IRQCH.prototype.get_next_transition_time = function() {
    var d, fh, base, gh;
    d = this.get_time() - this.count_load_time;
    switch (this.mode) {
        default:
        case 0:
        case 1:
            if (d < this.count)
                fh = this.count;
            else
                return -1;
            break;
        case 2:
            base = (d / this.count) * this.count;
            if ((d - base) == 0 && d != 0)
                fh = base + this.count;
            else
                fh = base + this.count + 1;
            break;
        case 3:
            base = (d / this.count) * this.count;
            gh = ((this.count + 1) >> 1);
            if ((d - base) < gh)
                fh = base + gh;
            else
                fh = base + this.count;
            break;
        case 4:
        case 5:
            if (d < this.count)
                fh = this.count;
            else if (d == this.count)
                fh = this.count + 1;
            else
                return -1;
            break;
    }
    fh = this.count_load_time + fh;
    return fh;
};
IRQCH.prototype.pit_load_count = function(x) {
    if (x == 0)
        x = 0x10000;
    this.count_load_time = this.get_time();
    this.count = x;
};



PIT.prototype.ioport_write = function(mem8_loc, x) {
    var hh, ih, s;
    mem8_loc &= 3;
    if (mem8_loc == 3) {
        hh = x >> 6;
        if (hh == 3)
            return;
        s = this.pit_channels[hh];
        ih = (x >> 4) & 3;
        switch (ih) {
            case 0:
                s.latched_count = s.pit_get_count();
                s.rw_state = 4;
                break;
            default:
                s.mode = (x >> 1) & 7;
                s.bcd = x & 1;
                s.rw_state = ih - 1 + 0;
                break;
        }
    } else {
        s = this.pit_channels[mem8_loc];
        switch (s.rw_state) {
            case 0:
                s.pit_load_count(x);
                break;
            case 1:
                s.pit_load_count(x << 8);
                break;
            case 2:
            case 3:
                if (s.rw_state & 1) {
                    s.pit_load_count((s.latched_count & 0xff) | (x << 8));
                } else {
                    s.latched_count = x;
                }
                s.rw_state ^= 1;
                break;
        }
    }
};
PIT.prototype.ioport_read = function(mem8_loc) {
    var Pg, ma, s;
    mem8_loc &= 3;
    s = this.pit_channels[mem8_loc];
    switch (s.rw_state) {
        case 0:
        case 1:
        case 2:
        case 3:
            ma = s.pit_get_count();
            if (s.rw_state & 1)
                Pg = (ma >> 8) & 0xff;
            else
                Pg = ma & 0xff;
            if (s.rw_state & 2)
                s.rw_state ^= 1;
            break;
        default:
        case 4:
        case 5:
            if (s.rw_state & 1)
                Pg = s.latched_count >> 8;
            else
                Pg = s.latched_count & 0xff;
            s.rw_state ^= 1;
            break;
    }
    return Pg;
};
PIT.prototype.speaker_ioport_write = function(mem8_loc, x) {
    this.speaker_data_on = (x >> 1) & 1;
    this.pit_channels[2].gate = x & 1;
};
PIT.prototype.speaker_ioport_read = function(mem8_loc) {
    var eh, s, x;
    s = this.pit_channels[2];
    eh = s.pit_get_out();
    x = (this.speaker_data_on << 1) | s.gate | (eh << 5);
    return x;
};
PIT.prototype.update_irq = function() {
    this.set_irq(1);
    this.set_irq(0);
};

